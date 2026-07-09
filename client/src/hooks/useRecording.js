import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Manages all recording state and logic.
 * Extracted from App.jsx to keep it under 800 lines per AGENTS.md.
 *
 * @param {object} opts
 * @param {React.MutableRefObject} opts.destRef    - MediaStreamAudioDestinationNode ref
 * @param {function} opts.addLog
 */
export function useRecording({ destRef, addLog }) {
  const [isAudioRecording, setIsAudioRecording] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const audioRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

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
    setRecordingSeconds(0);
    timerIntervalRef.current = setInterval(() => {
      setRecordingSeconds(prev => prev + 1);
    }, 1000);
    addLog('🎙️ Audio-only recording ACTIVE!');
  }, [destRef, addLog]);

  const stopAudioOnlyRecording = useCallback(() => {
    if (audioRecorderRef.current?.state !== 'inactive') audioRecorderRef.current?.stop();
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setIsAudioRecording(false);
  }, []);

  const clearRecordings = useCallback(() => {
    setRecordings(prev => {
      prev.forEach(rec => URL.revokeObjectURL(rec.url));
      return [];
    });
  }, []);

  return {
    isAudioRecording, recordings, recordingSeconds,
    startAudioOnlyRecording, stopAudioOnlyRecording,
    clearRecordings,
  };
}
