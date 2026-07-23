import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  isValidRemoteCommand,
  normalizeJoinResponse,
  normalizePcmPayload,
  normalizeRoomState,
  normalizeVirtualMicState,
} from '../utils/socketValidation';
import {
  JOIN_TIMEOUT_MS,
  TELEMETRY_POLL_INTERVAL_MS,
  WATCHDOG_CHECK_INTERVAL_MS,
  SILENCE_THRESHOLD_MS,
  ROLE_SENDER,
  ROLE_RECEIVER,
} from '../constants';

const STATUS_MESSAGES = {
  joiningPhone: 'Connecting phone to studio room…',
  joiningReceiver: 'Connecting PC receiver to studio room…',
  phoneWaitingForPc: 'Microphone ready. Waiting for PC receiver…',
  receiverWaitingForPhone: 'PC receiver ready. Waiting for phone…',
  receiverWaitingForAudio: 'Phone connected. Waiting for audio…',
  receiverStreaming: 'Receiving phone audio.',
  receiverSignalLost: 'Phone audio stopped. Waiting for it to return…',
  serverDisconnected: 'Server disconnected. Reconnecting…',
};
const JOIN_FAILED_MESSAGE = 'Could not join the studio room. Please try again.';
const REMOTE_ACK_DURATION_MS = 2500;

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
  isSenderAudioReady,
}) {
  const [operatorIssue, setOperatorIssue] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [latency, setLatency] = useState(null);
  const [bitrate, setBitrate] = useState(null);
  const [joinError, setJoinError] = useState(null);
  const [virtualMicState, setVirtualMicState] = useState(null);
  const bytesCountRef = useRef(0);
  const roleRef = useRef(role);
  const roomIdRef = useRef(roomId);
  const inputGainRef = useRef(inputGain);
  const isSenderAudioReadyRef = useRef(isSenderAudioReady);
  const remoteAckTimerRef = useRef(null);

  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { inputGainRef.current = inputGain; }, [inputGain]);
  useEffect(() => { isSenderAudioReadyRef.current = isSenderAudioReady; }, [isSenderAudioReady]);

  const getRemoteAckMessage = (cmd) => {
    if (cmd.type === 'gain') return `✅ Phone confirmed gain: ${Math.round(cmd.value * 100)}%`;
    if (cmd.value) return '🔇 Phone confirmed: Muted';
    return '🔊 Phone confirmed: Unmuted';
  };

  const reportJoinFailure = useCallback((message) => {
    setJoinError(message);
    setOperatorIssue(message);
    setStatus(message);
    addLog(`❌ ${message}`);
  }, [addLog, setStatus]);

  const joinRoom = useCallback((socket, targetRoomId, targetRole) => {
    if (!socket?.connected) return;
    setJoinError(null);
    setRoomState(null);
    if (targetRole === ROLE_RECEIVER) setVirtualMicState(null);
    const joiningStatus = targetRole === ROLE_SENDER
      ? STATUS_MESSAGES.joiningPhone
      : STATUS_MESSAGES.joiningReceiver;
    setStatus(joiningStatus);

    socket.timeout(JOIN_TIMEOUT_MS).emit('join-room', targetRoomId, targetRole, (error, payload) => {
      if (roleRef.current !== targetRole) return;
      if (roomIdRef.current !== targetRoomId) return;
      if (error) {
        reportJoinFailure('The server did not answer the room request. Check the connection and try again.');
        return;
      }

      const response = normalizeJoinResponse(payload);
      if (!response) {
        reportJoinFailure(JOIN_FAILED_MESSAGE);
        return;
      }
      if (!response.ok) {
        reportJoinFailure(response.message);
        return;
      }

      setOperatorIssue(null);
      addLog(`🔄 Joined room: ${targetRoomId}`);
      if (targetRole === ROLE_RECEIVER) {
        setStatus(STATUS_MESSAGES.receiverWaitingForPhone);
        return;
      }
      setStatus(STATUS_MESSAGES.phoneWaitingForPc);
    });
  }, [addLog, reportJoinFailure, setStatus]);

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
        addLog(`🔄 Auto-rejoined room: ${roomIdRef.current}`);
        joinRoom(socket, roomIdRef.current, roleRef.current);
        setIsSignalLost(false);
      }
    });

    socket.on('disconnect', (reason) => {
      addLog(`⚠️ Socket disconnected: ${reason}`);
      setLatency(null);
      setBitrate(null);
      setRoomState(null);
      setVirtualMicState(null);
      if (!roleRef.current) return;
      setStatus(STATUS_MESSAGES.serverDisconnected);
    });

    socket.on('room-state', (state) => {
      const normalizedState = normalizeRoomState(state, roomIdRef.current);
      if (!normalizedState) return;
      setRoomState(normalizedState);

      if (roleRef.current === ROLE_RECEIVER) {
        if (normalizedState.senders === 0) {
          const receiverStatus = hasConnectedOnceRef.current
            ? STATUS_MESSAGES.receiverSignalLost
            : STATUS_MESSAGES.receiverWaitingForPhone;
          setStatus(receiverStatus);
          if (hasConnectedOnceRef.current) setIsSignalLost(true);
          return;
        }
        if (!hasConnectedOnceRef.current) setStatus(STATUS_MESSAGES.receiverWaitingForAudio);
        return;
      }

      if (roleRef.current !== ROLE_SENDER) return;
      if (!isSenderAudioReadyRef.current) return;
      const senderStatus = normalizedState.receivers > 0
        ? 'Broadcasting phone audio to PC.'
        : STATUS_MESSAGES.phoneWaitingForPc;
      setStatus(senderStatus);
    });

    socket.on('server-warning', (payload) => {
      if (!payload || typeof payload.message !== 'string') return;
      setOperatorIssue(payload.message);
      addLog(`⚠️ ${payload.message}`);
    });

    socket.on('virtual-mic-state', (payload) => {
      const nextState = normalizeVirtualMicState(payload, roomIdRef.current);
      if (!nextState) return;
      setVirtualMicState(nextState);
      if (!nextState.ready) return;
      setOperatorIssue(null);
      addLog(`✅ System microphone ready: ${nextState.sourceName}`);
    });

    return () => {
      socket.off('room-state');
      socket.off('server-warning');
      socket.off('virtual-mic-state');
      socket.disconnect();
    };
  }, [addLog, hasConnectedOnceRef, joinRoom, setIsSignalLost, setStatus, socketRef]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!role || !socket?.connected) return;
    joinRoom(socket, roomId, role);
  }, [role, roomId, joinRoom, socketRef]);

  // Telemetry, ping, remote control, and packet reception
  useEffect(() => {
    const socket = socketRef.current;
    if (!role || !socket) return;

    socket.on('pong-rtt', (startTime) => {
      const rtt = Date.now() - startTime;
      setLatency(rtt);
    });

    // Remote control listener (only active on the phone sender)
    if (role === ROLE_SENDER) {
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
            senderGainNodeRef.current.gain.value = value ? 0 : inputGainRef.current;
          }
          addLog(value ? '🔇 Remote Muted by PC' : '🔊 Remote Unmuted by PC');
          socket.emit('remote-control-ack', { type: 'mute', value }, roomIdRef.current);
        }
      });
    }

    // ACK listener on PC receiver side — sync the slider value
    if (role === ROLE_RECEIVER) {
      socket.on('remote-control-ack', (cmd) => {
        if (!isValidRemoteCommand(cmd)) return;
        if (cmd.type === 'gain') {
          setRemotePhoneGain(cmd.value);
        }
        const msg = getRemoteAckMessage(cmd);
        setRemoteAckMsg(msg);
        if (remoteAckTimerRef.current) clearTimeout(remoteAckTimerRef.current);
        remoteAckTimerRef.current = setTimeout(() => {
          setRemoteAckMsg(null);
          remoteAckTimerRef.current = null;
        }, REMOTE_ACK_DURATION_MS);
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
      if (remoteAckTimerRef.current) {
        clearTimeout(remoteAckTimerRef.current);
        remoteAckTimerRef.current = null;
      }
    };
  }, [role, inputGain, setInputGain, setIsPhoneMuted, setRemotePhoneGain, setRemoteAckMsg, senderGainNodeRef, addLog, socketRef]);

  // Listen for pcm-chunks on receiver
  useEffect(() => {
    const socket = socketRef.current;
    if (role !== ROLE_RECEIVER || !socket) return;

    let isFirstChunk = true;

    socket.on('pcm-chunk', (data) => {
      if (roleRef.current !== 'receiver') return;
      if (!receiverPlaybackNodeRef.current) return;

      const pcmData = normalizePcmPayload(data);
      if (!pcmData) return;
      const { buffer, sampleRate, channelCount } = pcmData;

      lastChunkTimeRef.current = performance.now();
      bytesCountRef.current += buffer.byteLength;

      if (isFirstChunk) {
        hasConnectedOnceRef.current = true;
        setStatus(STATUS_MESSAGES.receiverStreaming);
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
    if (role !== ROLE_RECEIVER) return;

    const watchdog = setInterval(() => {
      if (!hasConnectedOnceRef.current) return;
      if (roleRef.current !== ROLE_RECEIVER) return;

      const silenceDuration = performance.now() - lastChunkTimeRef.current;
      if (silenceDuration > SILENCE_THRESHOLD_MS) {
        if (isSignalLost) return;
        setIsSignalLost(true);
        setStatus(STATUS_MESSAGES.receiverSignalLost);
        return;
      }

      if (!isSignalLost) return;
      setIsSignalLost(false);
      setStatus(STATUS_MESSAGES.receiverStreaming);
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
    joinError,
    virtualMicState,
    clearJoinError: () => setJoinError(null),
  };
}
