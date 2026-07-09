'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Ensure ~/Videos exists
if (!fs.existsSync(config.videosDir)) fs.mkdirSync(config.videosDir, { recursive: true });

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
  if (sessions[roomId]) return { ok: true };

  const sinkName = `BMS_${roomId}`;
  const { code, out: moduleId } = await spawnPactl([
    'load-module', 'module-null-sink',
    `sink_name=${sinkName}`,
    `sink_properties=device.description="Black Mic Studio [${roomId}]"`,
  ]);

  if (code !== 0) {
    const message = `Failed to create virtual sink for room ${roomId}. Is PipeWire/PulseAudio pactl available?`;
    console.error(`[BMS] ${message}`);
    return { ok: false, message };
  }

  sessions[roomId] = { sinkName, moduleId, audioBridge: null, recorder: null, sampleRate: 48000, channelCount: 1 };
  console.log(`[BMS] Virtual sink ready: ${sinkName} (module ${moduleId})`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Audio bridge: PCM stdin -> PulseAudio virtual sink
// ---------------------------------------------------------------------------

function feedAudio(roomId, pcmBuffer, sampleRate, channelCount) {
  const s = sessions[roomId];
  if (!s) return;

  // Restart bridge if format changes mid-stream
  if (s.audioBridge && (s.sampleRate !== sampleRate || s.channelCount !== channelCount)) {
    console.log(`[BMS] Format changed from ${s.sampleRate}Hz ${s.channelCount}ch to ${sampleRate}Hz ${channelCount}ch. Restarting bridge...`);
    if (s.audioBridge.stdin.writable) s.audioBridge.stdin.end();
    s.audioBridge = null;
  }

  if (!s.audioBridge) {
    s.sampleRate = sampleRate;
    s.channelCount = channelCount;
    const env = { ...process.env, LIBVA_DRIVER_NAME: config.libvaDriver };
    const audioBridge = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 's16le', '-ar', String(sampleRate), '-ac', String(channelCount), '-i', 'pipe:0',
      '-f', 'pulse', s.sinkName,
    ], { env });
    s.audioBridge = audioBridge;
    audioBridge.on('error', e => console.error('[BMS] Audio bridge error:', e.message));
    audioBridge.on('close', () => {
      if (s.audioBridge !== audioBridge) return;
      s.audioBridge = null;
    });
    console.log(`[BMS] Audio bridge: ${sampleRate}Hz ${channelCount}ch -> ${s.sinkName}`);
  }

  if (s.audioBridge.stdin.writable) s.audioBridge.stdin.write(Buffer.from(pcmBuffer));
}

// ---------------------------------------------------------------------------
// VAAPI screen recorder: JPEG frame pipe + PulseAudio audio
// ---------------------------------------------------------------------------

function startRecording(roomId, io) {
  const s = sessions[roomId];
  if (!s) return { ok: false, message: 'Recording cannot start until the PC receiver room is initialized.' };
  if (s.recorder) {
    const message = `Recording already active for room ${roomId}.`;
    console.warn(`[BMS] ${message}`);
    return { ok: false, message };
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = path.join(config.videosDir, `BMS-${ts}.mp4`);
  const monitorSource = `${s.sinkName}.monitor`;
  const env = { ...process.env, LIBVA_DRIVER_NAME: config.libvaDriver };

  const recorder = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-vaapi_device', config.vaapiDevice,
    // Video: JPEG frames from browser canvas via stdin pipe
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-r', String(config.recordFps), '-i', 'pipe:0',
    // Audio: virtual PipeWire sink monitor (phone mic)
    '-f', 'pulse', '-ac', String(s.channelCount), '-ar', String(s.sampleRate), '-i', monitorSource,
    // VAAPI H.264 encode
    '-vf', 'format=nv12,hwupload',
    '-c:v', 'h264_vaapi', '-rc_mode', 'VBR', '-b:v', config.videoBitrate,
    '-c:a', 'aac', '-b:a', config.audioBitrate,
    '-vsync', 'cfr', '-async', '1',
    outputFile,
  ], { env });
  s.recorder = recorder;

  recorder.stderr.on('data', d => process.stdout.write(`[ffmpeg] ${d}`));
  recorder.on('error', e => console.error('[BMS] Recorder error:', e.message));
  recorder.on('close', code => {
    const success = code === 0 || code === null;
    const sizeMB = success && fs.existsSync(outputFile)
      ? (fs.statSync(outputFile).size / (1024 * 1024)).toFixed(2)
      : '0';
    io.to(roomId).emit('record-complete', { success, file: path.basename(outputFile), sizeMB });
    if (s.recorder === recorder) s.recorder = null;
    console.log(`[BMS] Recording done: ${outputFile} (${sizeMB} MB, code ${code})`);
  });

  console.log(`[BMS] VAAPI recording -> ${outputFile}`);
  return { ok: true, outputFile };
}

function feedVideoFrame(roomId, frameBuffer) {
  const s = sessions[roomId];
  if (s?.recorder?.stdin.writable) s.recorder.stdin.write(Buffer.from(frameBuffer));
}

function stopRecording(roomId) {
  const s = sessions[roomId];
  if (!s?.recorder) return;
  if (s.recorder.stdin.writable) {
    s.recorder.stdin.end();
    return;
  }
  s.recorder.kill('SIGTERM');
}

function stopProcess(childProcess) {
  if (!childProcess) return;
  if (childProcess.stdin?.writable) {
    childProcess.stdin.end();
    return;
  }
  childProcess.kill('SIGTERM');
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanupRoom(roomId) {
  const s = sessions[roomId];
  if (!s) return;

  stopRecording(roomId);

  stopProcess(s.audioBridge);

  if (s.moduleId) {
    spawn('pactl', ['unload-module', s.moduleId]).on('error', () => {});
    console.log(`[BMS] Virtual sink unloaded (module ${s.moduleId})`);
  }

  delete sessions[roomId];
}

module.exports = { initRoom, feedAudio, startRecording, feedVideoFrame, stopRecording, cleanupRoom };
