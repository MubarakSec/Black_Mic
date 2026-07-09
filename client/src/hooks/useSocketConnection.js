import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { isValidRemoteCommand, normalizePcmPayload } from '../utils/socketValidation';
import {
  TELEMETRY_POLL_INTERVAL_MS,
  WATCHDOG_CHECK_INTERVAL_MS,
  SILENCE_THRESHOLD_MS,
} from '../constants';

export function useSocketConnection({
  role,
  roomId,
  addLog,
  status,
  setStatus,
  socketRef,
  inputGain,
  setInputGain,
  setIsPhoneMuted,
  setRemotePhoneGain,
  setRemoteAckMsg,
  senderGainNodeRef,
  receiverPlaybackNodeRef,
  lastChunkTimeRef,
  hasConnectedOnceRef,
  isSignalLost,
  setIsSignalLost,
}) {
  const [operatorIssue, setOperatorIssue] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [latency, setLatency] = useState(null);
  const [bitrate, setBitrate] = useState(null);
  const bytesCountRef = useRef(0);
  const roleRef = useRef(role);
  const roomIdRef = useRef(roomId);

  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  const getRemoteAckMessage = (cmd) => {
    if (cmd.type === 'gain') return `✅ Phone confirmed gain: ${Math.round(cmd.value * 100)}%`;
    if (cmd.value) return '🔇 Phone confirmed: Muted';
    return '🔊 Phone confirmed: Unmuted';
  };

  const getActiveStatus = (activeRole) => {
    if (activeRole === 'sender') return 'Broadcasting lossless audio! 🔴';
    return 'Connected! Audio streaming perfectly. 🔴';
  };

  // Socket setup
  useEffect(() => {
    const socket = io({
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      addLog('✅ Connected to Node Server');
      setOperatorIssue(null);
      if (roleRef.current) {
        socket.emit('join-room', roomIdRef.current, roleRef.current);
        addLog(`🔄 Auto-rejoined room: ${roomIdRef.current}`);
        setStatus(getActiveStatus(roleRef.current));
        setIsSignalLost(false);
      }
    });

    socket.on('disconnect', (reason) => {
      addLog(`⚠️ Socket disconnected: ${reason}`);
    });

    socket.on('reconnect', (attempt) => {
      addLog(`✅ Reconnected after ${attempt} attempt(s)`);
    });

    socket.on('room-state', (state) => {
      if (!state || state.roomId !== roomIdRef.current) return;
      setRoomState({
        senders: Number.isInteger(state.senders) ? state.senders : 0,
        receivers: Number.isInteger(state.receivers) ? state.receivers : 0,
      });
    });

    socket.on('server-warning', (payload) => {
      if (!payload || typeof payload.message !== 'string') return;
      setOperatorIssue(payload.message);
      addLog(`⚠️ ${payload.message}`);
    });

    return () => {
      socket.off('room-state');
      socket.off('server-warning');
      socket.disconnect();
    };
  }, [addLog, setIsSignalLost, setStatus, socketRef]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!role || !socket?.connected) return;
    socket.emit('join-room', roomId, role);
    addLog(`🔄 Joined room: ${roomId}`);
    setStatus(getActiveStatus(role));
    setIsSignalLost(false);
  }, [role, roomId, addLog, setIsSignalLost, setStatus, socketRef]);

  // Telemetry, ping, remote control, and packet reception
  useEffect(() => {
    const socket = socketRef.current;
    if (!role || !socket) return;

    socket.on('pong-rtt', (startTime) => {
      const rtt = Date.now() - startTime;
      setLatency(rtt);
    });

    // Remote control listener (only active on the phone sender)
    if (role === 'sender') {
      socket.on('remote-control', (cmd) => {
        if (!isValidRemoteCommand(cmd)) return;
        const { type, value } = cmd;
        if (type === 'gain') {
          setInputGain(value);
          if (senderGainNodeRef.current) {
            senderGainNodeRef.current.gain.value = value;
          }
          addLog(`🎛️ Remote Gain set to ${Math.round(value * 100)}%`);
          socket.emit('remote-control-ack', { type: 'gain', value }, roomIdRef.current);
          return;
        }
        if (type === 'mute') {
          setIsPhoneMuted(value);
          if (senderGainNodeRef.current) {
            senderGainNodeRef.current.gain.value = value ? 0 : inputGain;
          }
          addLog(value ? '🔇 Remote Muted by PC' : '🔊 Remote Unmuted by PC');
          socket.emit('remote-control-ack', { type: 'mute', value }, roomIdRef.current);
        }
      });
    }

    // ACK listener on PC receiver side — sync the slider value
    if (role === 'receiver') {
      socket.on('remote-control-ack', (cmd) => {
        if (!isValidRemoteCommand(cmd)) return;
        if (cmd.type === 'gain') {
          setRemotePhoneGain(cmd.value);
        }
        const msg = getRemoteAckMessage(cmd);
        setRemoteAckMsg(msg);
        setTimeout(() => setRemoteAckMsg(null), 2500);
      });
    }

    const interval = setInterval(() => {
      if (socket.connected) {
        socket.emit('ping-rtt', Date.now());
        const kbps = Math.round((bytesCountRef.current * 8) / 1000);
        setBitrate(kbps);
        bytesCountRef.current = 0;
      }
    }, TELEMETRY_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      socket.off('pong-rtt');
      socket.off('remote-control');
      socket.off('remote-control-ack');
    };
  }, [role, inputGain, setInputGain, setIsPhoneMuted, setRemotePhoneGain, setRemoteAckMsg, senderGainNodeRef, addLog, socketRef]);

  // Listen for pcm-chunks on receiver
  useEffect(() => {
    const socket = socketRef.current;
    if (role !== 'receiver' || !socket) return;

    let isFirstChunk = true;

    socket.on('pcm-chunk', (data) => {
      if (roleRef.current !== 'receiver') return;
      if (!receiverPlaybackNodeRef.current) return;

      const pcmData = normalizePcmPayload(data);
      if (!pcmData) return;
      const { buffer, sampleRate, channelCount } = pcmData;

      lastChunkTimeRef.current = Date.now();
      bytesCountRef.current += buffer.byteLength;

      if (isFirstChunk) {
        hasConnectedOnceRef.current = true;
        setStatus('Connected! Audio streaming perfectly. 🔴');
        addLog(`🔊 Receiving lossless Int16 audio at ${sampleRate}Hz!`);
        isFirstChunk = false;
      }

      receiverPlaybackNodeRef.current.port.postMessage({
        type: 'pcm',
        buffer,
        sampleRate,
        channelCount,
      }, [buffer]);
    });

    return () => {
      socket.off('pcm-chunk');
    };
  }, [role, receiverPlaybackNodeRef, lastChunkTimeRef, hasConnectedOnceRef, addLog, setStatus, socketRef]);

  // Disconnection Watchdog (checks if chunks stop arriving)
  useEffect(() => {
    if (role !== 'receiver') return;

    const watchdog = setInterval(() => {
      if (hasConnectedOnceRef.current && roleRef.current === 'receiver') {
        const silenceDuration = Date.now() - lastChunkTimeRef.current;
        if (silenceDuration > SILENCE_THRESHOLD_MS) {
          if (!isSignalLost) {
            setIsSignalLost(true);
            setStatus('⚠️ Microphone disconnected!');
          }
        } else {
          if (isSignalLost) {
            setIsSignalLost(false);
            setStatus('Connected! Audio streaming perfectly. 🔴');
          }
        }
      }
    }, WATCHDOG_CHECK_INTERVAL_MS);

    return () => {
      clearInterval(watchdog);
      setIsSignalLost(false);
    };
  }, [role, isSignalLost, lastChunkTimeRef, hasConnectedOnceRef, setIsSignalLost, setStatus]);

  return {
    socketRef,
    status,
    setStatus,
    operatorIssue,
    setOperatorIssue,
    roomState,
    setRoomState,
    latency,
    bitrate,
  };
}
