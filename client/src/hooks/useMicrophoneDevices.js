import { useState, useEffect, useCallback } from 'react';
import { LS_MIC_DEVICE_ID } from '../constants';
import { readStoredValue, writeStoredValue } from '../utils/storage';
import { rankMicrophones } from '../utils/micRecommendation';

export function useMicrophoneDevices() {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => readStoredValue(LS_MIC_DEVICE_ID, ''));

  const refreshDevices = useCallback(async () => {
    if (!navigator?.mediaDevices?.enumerateDevices) return [];
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const ranked = rankMicrophones(allDevices);
      setDevices(ranked);

      // If no valid selection yet and we found devices, pick the top-ranked recommended mic
      if (ranked.length > 0) {
        setSelectedDeviceId((prevId) => {
          const exists = ranked.some((d) => d.deviceId === prevId);
          if (exists && prevId) return prevId;
          return ranked[0].deviceId;
        });
      }

      return ranked;
    } catch (err) {
      console.warn('[BMS] Could not enumerate audio input devices:', err);
      return [];
    }
  }, []);

  useEffect(() => {
    // Device enumeration is an external-system sync; setState happens in a
    // microtask after enumerateDevices resolves, not synchronously.
    // oxlint-disable-next-line react/set-state-in-effect
    refreshDevices();

    if (!navigator?.mediaDevices) return;
    const handleDeviceChange = () => {
      refreshDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    writeStoredValue(LS_MIC_DEVICE_ID, selectedDeviceId);
  }, [selectedDeviceId]);

  const selectedDeviceRecommendation = devices.find((d) => d.deviceId === selectedDeviceId) || devices[0] || null;

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    selectedDeviceRecommendation,
    refreshDevices,
  };
}
