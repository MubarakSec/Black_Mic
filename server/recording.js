'use strict';

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Intel Haswell iGPU render device (verified working with i965 VA-API driver)
const VAAPI_DEVICE = '/dev/dri/renderD129';
const LIBVA_DRIVER = 'i965';
const VIDEOS_DIR = path.join(os.homedir(), 'Videos');
const RECORD_FPS = 20;
const VIDEO_BITRATE = '4M';
const AUDIO_BITRATE = '192k';

// Ensure ~/Videos exists
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

/**
 * Per-room session state.
 * @type {Record<string, {sinkName, moduleId, audioBridge, recorder, sampleRate, channelCount}>}
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
  if (sessions[roomId]) return;

  const sinkName = `BMS_${roomId}`;
  const { code, out: moduleId } = await spawnPactl([
    'load-module', 'module-null-sink',
    `sink_name=${sinkName}`,
    `sink_properties=device.description="Black Mic Studio [${roomId}]"`,
  ]);

  if (code !== 0) {
    console.error(`[BMS] Failed to create virtual sink for room ${roomId}`);
    return;
  }

  sessions[roomId] = { sinkName, moduleId, audioBridge: null, recorder: null, sampleRate: 48000, channelCount: 1 };
  console.log(`[BMS] Virtual sink ready: ${sinkName} (module ${moduleId})`);
}

// ---------------------------------------------------------------------------
// Audio bridge: PCM stdin -> PulseAudio virtual sink
// ---------------------------------------------------------------------------

function feedAudio(roomId, pcmBuffer, sampleRate, channelCount) {
  const s = sessions[roomId];
  if (!s) return;

  if (!s.audioBridge) {
    s.sampleRate = sampleRate;
    s.channelCount = channelCount;
    const env = { ...process.env, LIBVA_DRIVER_NAME: LIBVA_DRIVER };
    s.audioBridge = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 's16le', '-ar', String(sampleRate), '-ac', String(channelCount), '-i', 'pipe:0',
      '-f', 'pulse', s.sinkName,
    ], { env });
    s.audioBridge.on('error', e => console.error('[BMS] Audio bridge error:', e.message));
    console.log(`[BMS] Audio bridge: ${sampleRate}Hz ${channelCount}ch -> ${s.sinkName}`);
  }

  if (s.audioBridge.stdin.writable) s.audioBridge.stdin.write(Buffer.from(pcmBuffer));
}

// ---------------------------------------------------------------------------
// VAAPI screen recorder: JPEG frame pipe + PulseAudio audio
// ---------------------------------------------------------------------------

function startRecording(roomId, io) {
  const s = sessions[roomId];
  if (!s) return null;

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = path.join(VIDEOS_DIR, `BMS-${ts}.mp4`);
  const monitorSource = `${s.sinkName}.monitor`;
  const env = { ...process.env, LIBVA_DRIVER_NAME: LIBVA_DRIVER };

  s.recorder = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-vaapi_device', VAAPI_DEVICE,
    // Video: JPEG frames from browser canvas via stdin pipe
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-r', String(RECORD_FPS), '-i', 'pipe:0',
    // Audio: virtual PipeWire sink monitor (phone mic)
    '-f', 'pulse', '-ac', String(s.channelCount), '-ar', String(s.sampleRate), '-i', monitorSource,
    // VAAPI H.264 encode
    '-vf', 'format=nv12,hwupload',
    '-c:v', 'h264_vaapi', '-rc_mode', 'VBR', '-b:v', VIDEO_BITRATE,
    '-c:a', 'aac', '-b:a', AUDIO_BITRATE,
    '-vsync', 'cfr', '-async', '1',
    outputFile,
  ], { env });

  s.recorder.stderr.on('data', d => process.stdout.write(`[ffmpeg] ${d}`));
  s.recorder.on('close', code => {
    const success = code === 0 || code === null;
    const sizeMB = success && fs.existsSync(outputFile)
      ? (fs.statSync(outputFile).size / (1024 * 1024)).toFixed(2)
      : '0';
    io.to(roomId).emit('record-complete', { success, file: path.basename(outputFile), sizeMB });
    s.recorder = null;
    console.log(`[BMS] Recording done: ${outputFile} (${sizeMB} MB, code ${code})`);
  });

  console.log(`[BMS] VAAPI recording -> ${outputFile}`);
  return outputFile;
}

function feedVideoFrame(roomId, frameBuffer) {
  const s = sessions[roomId];
  if (s?.recorder?.stdin.writable) s.recorder.stdin.write(Buffer.from(frameBuffer));
}

function stopRecording(roomId) {
  const s = sessions[roomId];
  if (s?.recorder?.stdin.writable) s.recorder.stdin.end();
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanupRoom(roomId) {
  const s = sessions[roomId];
  if (!s) return;

  stopRecording(roomId);

  if (s.audioBridge?.stdin.writable) s.audioBridge.stdin.end();

  if (s.moduleId) {
    spawn('pactl', ['unload-module', s.moduleId]).on('error', () => {});
    console.log(`[BMS] Virtual sink unloaded (module ${s.moduleId})`);
  }

  delete sessions[roomId];
}

module.exports = { initRoom, feedAudio, startRecording, feedVideoFrame, stopRecording, cleanupRoom };
