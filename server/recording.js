'use strict';

const { spawn } = require('child_process');
const { upmixMonoToStereoBuffer } = require('./pcm-utils');

const DEFAULT_SAMPLE_RATE = 48000;
const MONO_CHANNEL_COUNT = 1;
const MONO_CHANNEL_MAP = 'mono';
const PCM_FLUSH_THRESHOLD_BYTES = 1920; // 10ms over USB

/**
 * Per-room session state.
 * @type {Record<string, {sinkName, sinkModuleId, sourceModuleId, audioBridge, sampleRate, channelCount}>}
 */
const sessions = {};
const initializingRooms = new Map();

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
  if (sessions[roomId]) return { ok: true };
  
  if (initializingRooms.has(roomId)) {
    return initializingRooms.get(roomId);
  }

  const initPromise = (async () => {
    const sinkName = `BMS_${roomId}_Sink`;
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
      `source_name=BlackMic_${roomId}`,
      `master=${sinkName}.monitor`,
      `source_properties=device.description="Black Mic"`
    ]);

    if (codeSource !== 0) {
      console.warn(`[BMS] Failed to create remap source. The monitor will still work, but won't be named 'Black Mic'.`);
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
    console.log(`[BMS] Virtual mic ready: Black Mic (modules ${sinkModuleId}, ${sourceModuleId || 'none'})`);
    return { ok: true };
  })();

  initializingRooms.set(roomId, initPromise);
  const result = await initPromise;
  initializingRooms.delete(roomId);
  return result;
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
    audioBridge.on('error', e => console.error('[BMS] Audio bridge error:', e.message));
    audioBridge.stdin.on('error', err => {
      if (err.code === 'EPIPE') {
        console.error('[BMS] EPIPE on pacat. The bridge died, will restart next frame.');
        if (s.audioBridge === audioBridge) s.audioBridge = null;
      } else {
        console.error('[BMS] Stdin error:', err.message);
      }
    });
    audioBridge.stdin.on('drain', () => {
      s.isDraining = false;
    });
    audioBridge.on('close', () => {
      if (s.audioBridge !== audioBridge) return;
      s.audioBridge = null;
    });
    console.log(`[BMS] pacat audio bridge: ${sampleRate}Hz mono -> ${s.sinkName}`);
  }

  // The client now sends raw buffer, we just pass it straight through (no upmixing)
  // We guarantee aligned offset by copying to a new buffer
  const alignedBuffer = new ArrayBuffer(pcmBuffer.byteLength);
  new Uint8Array(alignedBuffer).set(pcmBuffer);
  const passThroughBuffer = Buffer.from(alignedBuffer);

  // Aggregate chunks into ~10ms blocks to prevent pipe starvation pops
  s.pcmBufferQueue.push(passThroughBuffer);
  s.pcmBufferBytes += passThroughBuffer.length;

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

function cleanupRoom(roomId) {
  const s = sessions[roomId];
  if (!s) return;

  stopProcess(s.audioBridge);

  if (s.sourceModuleId) {
    spawn('pactl', ['unload-module', s.sourceModuleId]).on('error', () => {});
  }
  if (s.sinkModuleId) {
    spawn('pactl', ['unload-module', s.sinkModuleId]).on('error', () => {});
    console.log(`[BMS] Virtual mic unloaded (modules ${s.sinkModuleId}, ${s.sourceModuleId || 'none'})`);
  }

  delete sessions[roomId];
}

module.exports = { initRoom, feedAudio, cleanupRoom };
