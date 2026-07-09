'use strict';

const { spawn } = require('child_process');
const { upmixMonoToStereoBuffer } = require('./pcm-utils');

const DEFAULT_SAMPLE_RATE = 48000;
const MONO_CHANNEL_COUNT = 1;
const STEREO_CHANNEL_COUNT = 2;
const STEREO_CHANNEL_MAP = 'front-left,front-right';
const PCM_FLUSH_THRESHOLD_BYTES = 5760;

/**
 * Per-room session state.
 * @type {Record<string, {sinkName, moduleId, audioBridge, sampleRate, channelCount}>}
 */
const sessions = {};

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

  const sinkName = `BMS_${roomId}`;
  const { code, out: moduleId } = await spawnPactl([
    'load-module', 'module-null-sink',
    `sink_name=${sinkName}`,
    `channels=${STEREO_CHANNEL_COUNT}`,
    `channel_map=${STEREO_CHANNEL_MAP}`,
    `sink_properties=device.description="Black Mic Studio [${roomId}]"`,
  ]);

  if (code !== 0) {
    const message = `Failed to create virtual sink for room ${roomId}. Is PipeWire/PulseAudio pactl available?`;
    console.error(`[BMS] ${message}`);
    return { ok: false, message };
  }

  sessions[roomId] = { 
    sinkName, 
    moduleId, 
    audioBridge: null, 
    sampleRate: DEFAULT_SAMPLE_RATE,
    channelCount: MONO_CHANNEL_COUNT,
    pcmBufferQueue: [],
    pcmBufferBytes: 0
  };
  console.log(`[BMS] Virtual sink ready: ${sinkName} (module ${moduleId})`);
  return { ok: true };
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
    // Always output stereo to the virtual sink to fill both L and R
    const audioBridge = spawn('pacat', [
      '--playback',
      `--device=${s.sinkName}`,
      '--format=s16le',
      `--rate=${sampleRate}`,
      `--channels=${STEREO_CHANNEL_COUNT}`,
      `--channel-map=${STEREO_CHANNEL_MAP}`,
      '--latency-msec=30'
    ], { stdio: ['pipe', 'ignore', 'ignore'] });
    s.audioBridge = audioBridge;
    audioBridge.on('error', e => console.error('[BMS] Audio bridge error:', e.message));
    audioBridge.on('close', () => {
      if (s.audioBridge !== audioBridge) return;
      s.audioBridge = null;
    });
    console.log(`[BMS] pacat audio bridge: ${sampleRate}Hz stereo -> ${s.sinkName}`);
  }

  // Fast TypedArray upmix: duplicate mono sample to both channels
  const stereoBuffer = channelCount === MONO_CHANNEL_COUNT
    ? upmixMonoToStereoBuffer(pcmBuffer)
    : Buffer.from(pcmBuffer);

  // Aggregate chunks into ~30ms blocks to prevent pipe starvation pops
  s.pcmBufferQueue.push(stereoBuffer);
  s.pcmBufferBytes += stereoBuffer.length;

  if (s.pcmBufferBytes >= PCM_FLUSH_THRESHOLD_BYTES) {
    const chunk = Buffer.concat(s.pcmBufferQueue);
    if (s.audioBridge.stdin.writable) {
      s.audioBridge.stdin.write(chunk);
    }
    s.pcmBufferQueue = [];
    s.pcmBufferBytes = 0;
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

  if (s.moduleId) {
    spawn('pactl', ['unload-module', s.moduleId]).on('error', () => {});
    console.log(`[BMS] Virtual sink unloaded (module ${s.moduleId})`);
  }

  delete sessions[roomId];
}

module.exports = { initRoom, feedAudio, cleanupRoom };
