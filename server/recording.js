'use strict';

const { spawn } = require('child_process');
const { downmixStereoToMonoBuffer } = require('./pcm-utils');
const { routeEasyEffects } = require('./easyeffects-router');

const DEFAULT_SAMPLE_RATE = 48000;
const MONO_CHANNEL_COUNT = 1;
const MONO_CHANNEL_MAP = 'mono';
const PCM_BYTES_PER_SAMPLE = 2;
const AUDIO_WORKLET_BATCH_FRAMES = 512;
const PCM_FLUSH_THRESHOLD_BYTES = AUDIO_WORKLET_BATCH_FRAMES * PCM_BYTES_PER_SAMPLE;
const DEFAULT_EASYEFFECTS_ROOM_ID = 'ROOM';
const EASYEFFECTS_ROOM_ID = process.env.BMS_EASYEFFECTS_ROOM || DEFAULT_EASYEFFECTS_ROOM_ID;

/**
 * Per-room session state.
 * @type {Record<string, {sinkName, sinkModuleId, sourceModuleId, audioBridge, sampleRate, channelCount}>}
 */
const sessions = {};
const initializingRooms = new Map();
const cleaningRooms = new Map();
const roomGenerations = new Map();

function getRoomGeneration(roomId) {
  return roomGenerations.get(roomId) || 0;
}

function advanceRoomGeneration(roomId) {
  const nextGeneration = getRoomGeneration(roomId) + 1;
  roomGenerations.set(roomId, nextGeneration);
  return nextGeneration;
}

// ---------------------------------------------------------------------------
// Virtual PipeWire sink helpers
// ---------------------------------------------------------------------------

function spawnPactl(args) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('pactl', args);
    p.stdout.on('data', d => (out += d));
    p.on('close', code => resolve({ code, out: out.trim() }));
    p.on('error', () => resolve({ code: -1, out: '' }));
  });
}

async function initRoom(roomId) {
  const pendingCleanup = cleaningRooms.get(roomId);
  if (pendingCleanup) await pendingCleanup;
  if (sessions[roomId]) return { ok: true };

  const existingInitialization = initializingRooms.get(roomId);
  if (existingInitialization) {
    const existingResult = await existingInitialization;
    if (!existingResult.cancelled) return existingResult;
    return initRoom(roomId);
  }

  const generation = getRoomGeneration(roomId);
  const initPromise = (async () => {
    const sinkName = `BMS_${roomId}_Sink`;
    const sourceName = `BlackMic_${roomId}`;
    const { code: codeSink, out: sinkModuleId } = await spawnPactl([
      'load-module', 'module-null-sink',
      `sink_name=${sinkName}`,
      `channels=${MONO_CHANNEL_COUNT}`,
      `channel_map=${MONO_CHANNEL_MAP}`,
      `sink_properties=device.description="BMS Receiver [${roomId}]"`
    ]);

    if (codeSink !== 0) {
      const message = `Failed to create virtual sink for room ${roomId}. Is PipeWire/PulseAudio pactl available?`;
      console.error(`[BMS] ${message}`);
      return { ok: false, message };
    }

    const { code: codeSource, out: sourceModuleId } = await spawnPactl([
      'load-module', 'module-remap-source',
      `source_name=${sourceName}`,
      `master=${sinkName}.monitor`,
      `source_properties=device.description="Black Mic"`
    ]);

    if (codeSource !== 0) {
      console.warn(`[BMS] Failed to create remap source. Rolling back null-sink module.`);
      await spawnPactl(['unload-module', sinkModuleId]);
      return { ok: false, message: `Failed to create remap source for room ${roomId}.` };
    }

    if (generation !== getRoomGeneration(roomId)) {
      await spawnPactl(['unload-module', sourceModuleId]);
      await spawnPactl(['unload-module', sinkModuleId]);
      return {
        ok: false,
        cancelled: true,
        message: `Receiver left room ${roomId} before virtual microphone setup completed.`,
      };
    }

    sessions[roomId] = { 
      sinkName, 
      sinkModuleId,
      sourceModuleId: codeSource === 0 ? sourceModuleId : null,
      audioBridge: null, 
      sampleRate: DEFAULT_SAMPLE_RATE,
      channelCount: MONO_CHANNEL_COUNT,
      pcmBufferQueue: [],
      pcmBufferBytes: 0,
      isDraining: false
    };
    if (roomId === EASYEFFECTS_ROOM_ID) {
      const routed = await routeEasyEffects(sourceName);
      const routeStatus = routed ? 'connected' : 'not available';
      console.log(`[BMS] EasyEffects route ${routeStatus}: ${sourceName}`);
    }
    console.log(`[BMS] Virtual mic ready: Black Mic (modules ${sinkModuleId}, ${sourceModuleId || 'none'})`);
    return { ok: true };
  })();

  const trackedPromise = initPromise.finally(() => {
    if (initializingRooms.get(roomId) !== trackedPromise) return;
    initializingRooms.delete(roomId);
  });
  initializingRooms.set(roomId, trackedPromise);
  return trackedPromise;
}

function resetBridgeState(session, bridge) {
  if (session.audioBridge === bridge) session.audioBridge = null;
  session.isDraining = false;
  session.pcmBufferQueue = [];
  session.pcmBufferBytes = 0;
}

// ---------------------------------------------------------------------------
// Audio bridge: PCM stdin -> PulseAudio virtual sink
// ---------------------------------------------------------------------------

function feedAudio(roomId, pcmBuffer, sampleRate, channelCount) {
  const s = sessions[roomId];
  if (!s) return;

  // Restart bridge if sample rate changes mid-stream
  if (s.audioBridge && s.sampleRate !== sampleRate) {
    console.log(`[BMS] Format changed from ${s.sampleRate}Hz to ${sampleRate}Hz. Restarting bridge...`);
    if (s.audioBridge.stdin.writable) s.audioBridge.stdin.end();
    s.audioBridge = null;
  }

  if (!s.audioBridge) {
    s.sampleRate = sampleRate;
    s.channelCount = channelCount;
    // Always output mono to the virtual sink
    const audioBridge = spawn('pacat', [
      '--playback',
      `--device=${s.sinkName}`,
      '--format=s16le',
      `--rate=${sampleRate}`,
      `--channels=${MONO_CHANNEL_COUNT}`,
      `--channel-map=${MONO_CHANNEL_MAP}`,
      '--latency-msec=10'
    ], { stdio: ['pipe', 'ignore', 'ignore'] });
    s.audioBridge = audioBridge;
    s.isDraining = false;
    audioBridge.on('error', e => console.error('[BMS] Audio bridge error:', e.message));
    audioBridge.stdin.on('error', err => {
      if (err.code === 'EPIPE') {
        console.error('[BMS] EPIPE on pacat. The bridge died, will restart next frame.');
        if (s.audioBridge === audioBridge) resetBridgeState(s, audioBridge);
      } else {
        console.error('[BMS] Stdin error:', err.message);
      }
    });
    audioBridge.stdin.on('drain', () => {
      if (s.audioBridge !== audioBridge) return;
      s.isDraining = false;
    });
    audioBridge.on('close', () => {
      if (s.audioBridge !== audioBridge) return;
      resetBridgeState(s, audioBridge);
    });
    console.log(`[BMS] pacat audio bridge: ${sampleRate}Hz mono -> ${s.sinkName}`);
  }

  // Downmix stereo to mono for the PipeWire sink (always mono)
  const monoBuffer = channelCount === 2 ? downmixStereoToMonoBuffer(pcmBuffer) : pcmBuffer;

  // Write one complete AudioWorklet packet at a time to minimize bridge latency.
  s.pcmBufferQueue.push(monoBuffer);
  s.pcmBufferBytes += monoBuffer.length;

  if (s.pcmBufferBytes >= PCM_FLUSH_THRESHOLD_BYTES) {
    const chunk = Buffer.concat(s.pcmBufferQueue);
    s.pcmBufferQueue = [];
    s.pcmBufferBytes = 0;
    
    if (s.isDraining) {
      // Drop packet if pipe is full (backpressure) to preserve low latency
      return;
    }

    if (s.audioBridge.stdin.writable) {
      const canAcceptMore = s.audioBridge.stdin.write(chunk);
      if (!canAcceptMore) {
        s.isDraining = true; // Wait for drain event
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function stopProcess(childProcess) {
  if (!childProcess) return;
  if (childProcess.stdin?.writable) {
    childProcess.stdin.end();
    return;
  }
  childProcess.kill('SIGTERM');
}

async function cleanupRoom(roomId) {
  advanceRoomGeneration(roomId);
  const pendingCleanup = cleaningRooms.get(roomId);
  if (pendingCleanup) return pendingCleanup;

  const s = sessions[roomId];
  if (!s) return;

  delete sessions[roomId];
  stopProcess(s.audioBridge);

  const cleanupPromise = (async () => {
    if (s.sourceModuleId) await spawnPactl(['unload-module', s.sourceModuleId]);
    if (s.sinkModuleId) await spawnPactl(['unload-module', s.sinkModuleId]);
    console.log(`[BMS] Virtual mic unloaded (modules ${s.sinkModuleId}, ${s.sourceModuleId || 'none'})`);
  })();
  const trackedCleanup = cleanupPromise.finally(() => {
    if (cleaningRooms.get(roomId) !== trackedCleanup) return;
    cleaningRooms.delete(roomId);
  });
  cleaningRooms.set(roomId, trackedCleanup);
  return trackedCleanup;
}

module.exports = { initRoom, feedAudio, cleanupRoom };
