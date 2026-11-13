import { useState, useRef, useEffect, useCallback } from 'react';
import { audioBufferToWav } from '../utils/wavEncoder';

/**
 * Manages all recording state and logic.
 * Extracted from App.jsx to keep it under 800 lines per AGENTS.md.
 *
 * @param {object} opts
 * @param {React.MutableRefObject} opts.destRef    - MediaStreamAudioDestinationNode ref
 * @param {function} opts.addLog
 */
const RECORDING_BITRATE_BPS = 128_000;

export function useRecording({ destRef, addLog }) {
  const [isAudioRecording, setIsAudioRecording] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const audioRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const keepStoppedRecordingRef = useRef(true);

  const clearRecordingTimer = useCallback(() => {
    if (!timerIntervalRef.current) return;
    clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      keepStoppedRecordingRef.current = false;
      clearRecordingTimer();
      if (audioRecorderRef.current?.state !== 'inactive') audioRecorderRef.current?.stop();
    };
  }, [clearRecordingTimer]);

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
    keepStoppedRecordingRef.current = true;
    audioRecorderRef.current = new MediaRecorder(audioStream, { mimeType, audioBitsPerSecond: RECORDING_BITRATE_BPS });
    audioRecorderRef.current.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    audioRecorderRef.current.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
      const recordingId = Date.now();
      if (keepStoppedRecordingRef.current) {
        setRecordings(prev => [{
          id: recordingId, url, timestamp: new Date().toLocaleTimeString(),
          duration: 'Audio only', size: `${sizeMB} MB`, mimeType,
          filename: `bms-audio-${recordingId}`,
        }, ...prev]);
      }
      addLog(`💾 Audio take saved (${sizeMB} MB)`);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bms-audio-${recordingId}.webm`;
      a.click();
      if (!keepStoppedRecordingRef.current) URL.revokeObjectURL(url);
      audioChunksRef.current = [];
      audioRecorderRef.current = null;
    };
    audioRecorderRef.current.onerror = () => {
      clearRecordingTimer();
      setIsAudioRecording(false);
      addLog('❌ Recording stopped because the browser reported an audio error.');
    };
    audioRecorderRef.current.start(1000);
    setIsAudioRecording(true);
    setRecordingSeconds(0);
    timerIntervalRef.current = setInterval(() => {
      setRecordingSeconds(prev => prev + 1);
    }, 1000);
    addLog('🎙️ Audio-only recording ACTIVE!');
  }, [destRef, addLog, clearRecordingTimer]);

  const stopAudioOnlyRecording = useCallback(() => {
    if (audioRecorderRef.current?.state !== 'inactive') audioRecorderRef.current?.stop();
    clearRecordingTimer();
    setIsAudioRecording(false);
  }, [clearRecordingTimer]);

  const finalizeRecordingForDisconnect = useCallback(() => {
    keepStoppedRecordingRef.current = false;
    if (audioRecorderRef.current?.state !== 'inactive') audioRecorderRef.current?.stop();
    clearRecordingTimer();
    setIsAudioRecording(false);
    setRecordingSeconds(0);
  }, [clearRecordingTimer]);

  const exportRecordingAsWav = useCallback(async (recording) => {
    if (!recording?.url) return;
    try {
      const response = await fetch(recording.url);
      const recorded = await response.arrayBuffer();
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        addLog('❌ WAV export needs Web Audio support.');
        return;
      }
      const audioContext = new AudioContextCtor();
      try {
        const decoded = await audioContext.decodeAudioData(recorded);
        const wav = audioBufferToWav(decoded);
        const blob = new Blob([wav], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${recording.filename}.wav`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        addLog('🎚️ Lossless WAV exported.');
      } finally {
        audioContext.close().catch(() => {});
      }
    } catch (err) {
      addLog(`❌ WAV export failed: ${err.message}`);
    }
  }, [addLog]);

  const clearRecordings = useCallback(() => {
    setRecordings(prev => {
      prev.forEach(rec => URL.revokeObjectURL(rec.url));
      return [];
    });
  }, []);

  return {
    isAudioRecording, recordings, recordingSeconds,
    startAudioOnlyRecording, stopAudioOnlyRecording,
    finalizeRecordingForDisconnect,
    exportRecordingAsWav,
    clearRecordings,
  };
}
