import { useState, useRef, useEffect, useCallback } from 'react';

const JPEG_QUALITY = 0.78;
const RECORD_FPS = 20;
const FRAME_MS = 1000 / RECORD_FPS;

/**
 * Manages all recording state and logic.
 * Extracted from App.jsx to keep it under 800 lines per AGENTS.md.
 *
 * @param {object} opts
 * @param {React.MutableRefObject} opts.socketRef
 * @param {React.MutableRefObject} opts.roomIdRef  - ref holding current roomId (avoids stale closure)
 * @param {React.MutableRefObject} opts.destRef    - MediaStreamAudioDestinationNode ref
 * @param {function} opts.addLog
 */
export function useRecording({ socketRef, roomIdRef, destRef, addLog }) {
  const [isAudioRecording, setIsAudioRecording] = useState(false);
  const [isVaapiRecording, setIsVaapiRecording] = useState(false);
  const [recordings, setRecordings] = useState([]);

  // Audio-only recording refs
  const audioRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // VAAPI recording refs
  const screenVideoRef = useRef(null);
  const screenCanvasRef = useRef(null);
  const frameRafRef = useRef(null);
  const isVaapiRecordingRef = useRef(false);
  const screenStreamRef = useRef(null);

  // -------------------------------------------------------------------------
  // Listen for server-side recording completion
  // -------------------------------------------------------------------------
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onComplete = ({ success, file, sizeMB }) => {
      if (success) {
        addLog(`💾 Saved to ~/Videos/${file} (${sizeMB} MB)`);
      } else {
        addLog('❌ VAAPI recording failed — check server logs.');
      }
    };

    socket.on('record-complete', onComplete);
    return () => socket.off('record-complete', onComplete);
  }, [socketRef, addLog]);

  // -------------------------------------------------------------------------
  // Audio-only recording (browser MediaRecorder — lightweight, no video)
  // -------------------------------------------------------------------------
  const startAudioOnlyRecording = useCallback(() => {
    if (!destRef.current) return;
    const audioStream = destRef.current.stream;
    if (!audioStream?.getAudioTracks().length) {
      addLog('❌ No audio stream available.');
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    audioChunksRef.current = [];
    audioRecorderRef.current = new MediaRecorder(audioStream, { mimeType });
    audioRecorderRef.current.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    audioRecorderRef.current.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
      setRecordings(prev => [{
        id: Date.now(), url, timestamp: new Date().toLocaleTimeString(),
        duration: 'Audio only', size: `${sizeMB} MB`, mimeType,
        filename: `bms-audio-${Date.now()}`,
      }, ...prev]);
      addLog(`💾 Audio take saved (${sizeMB} MB)`);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bms-audio-${Date.now()}.webm`;
      a.click();
    };
    audioRecorderRef.current.start(1000);
    setIsAudioRecording(true);
    addLog('🎙️ Audio-only recording ACTIVE!');
  }, [destRef, addLog]);

  const stopAudioOnlyRecording = useCallback(() => {
    if (audioRecorderRef.current?.state !== 'inactive') audioRecorderRef.current?.stop();
    setIsAudioRecording(false);
  }, []);

  // -------------------------------------------------------------------------
  // VAAPI recording: canvas frames -> server ffmpeg -> ~/Videos/*.mp4
  // -------------------------------------------------------------------------
  const stopVaapiRecording = useCallback(() => {
    isVaapiRecordingRef.current = false;
    setIsVaapiRecording(false);
    cancelAnimationFrame(frameRafRef.current);
    frameRafRef.current = null;
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
      screenVideoRef.current = null;
    }
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    socketRef.current?.emit('stop-vaapi-record', roomIdRef.current);
    addLog('⏹️ Stopping VAAPI recording — processing...');
  }, [socketRef, roomIdRef, addLog]);

  const startVaapiRecording = useCallback(async () => {
    try {
      addLog('🖥️ Requesting screen share for VAAPI recording...');
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: RECORD_FPS, max: 30 }, cursor: 'always' },
        audio: false, // audio comes from virtual PipeWire sink on server
      });
      screenStreamRef.current = screenStream;

      const track = screenStream.getVideoTracks()[0];
      const { width = 1920, height = 1080 } = track.getSettings();
      // VAAPI requires even-numbered dimensions
      const capW = width % 2 === 0 ? width : width - 1;
      const capH = height % 2 === 0 ? height : height - 1;

      // Hidden video element to read frames from
      const video = document.createElement('video');
      video.srcObject = screenStream;
      video.muted = true;
      await video.play();
      screenVideoRef.current = video;

      // Offscreen canvas for JPEG conversion
      const canvas = document.createElement('canvas');
      canvas.width = capW;
      canvas.height = capH;
      screenCanvasRef.current = canvas;
      const ctx = canvas.getContext('2d', { alpha: false });

      // Tell server to start ffmpeg with VAAPI
      socketRef.current.emit('start-vaapi-record', { width: capW, height: capH }, roomIdRef.current);

      isVaapiRecordingRef.current = true;
      setIsVaapiRecording(true);
      addLog(`⏺️ VAAPI: ${capW}×${capH} @ ${RECORD_FPS}fps → ~/Videos/`);

      // Frame capture loop via requestAnimationFrame
      let lastTime = 0;
      const loop = (ts) => {
        if (!isVaapiRecordingRef.current) return;
        if (ts - lastTime >= FRAME_MS) {
          lastTime = ts;
          ctx.drawImage(video, 0, 0, capW, capH);
          canvas.toBlob((blob) => {
            if (!blob || !isVaapiRecordingRef.current || !socketRef.current?.connected) return;
            blob.arrayBuffer().then(buf => {
              socketRef.current.emit('video-frame', buf, roomIdRef.current);
            });
          }, 'image/jpeg', JPEG_QUALITY);
        }
        frameRafRef.current = requestAnimationFrame(loop);
      };
      frameRafRef.current = requestAnimationFrame(loop);

      // Stop gracefully if user ends screen share from browser UI
      track.addEventListener('ended', () => stopVaapiRecording());
    } catch (e) {
      addLog(`❌ VAAPI recording error: ${e.message}`);
    }
  }, [socketRef, roomIdRef, addLog, stopVaapiRecording]);

  return {
    isAudioRecording, isVaapiRecording, recordings,
    startAudioOnlyRecording, stopAudioOnlyRecording,
    startVaapiRecording, stopVaapiRecording,
  };
}
