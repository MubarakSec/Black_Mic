import { useState, useEffect } from 'react';

const USB_POLL_INTERVAL_MS = 5000;
const VALID_STATES = new Set(['device', 'unauthorized', 'none', 'missing']);

/**
 * Polls the server's /usb-status endpoint so the console can show whether
 * a phone is attached and ready over USB. Returns null until the first
 * response arrives.
 */
export function useUsbStatus() {
  const [usbStatus, setUsbStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const res = await fetch('/usb-status', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const state = VALID_STATES.has(data?.state) ? data.state : 'missing';
        if (!cancelled) {
          setUsbStatus({
            available: data?.available === true,
            state,
            ready: data?.ready === true,
            devices: Array.isArray(data?.devices) ? data.devices : [],
          });
        }
      } catch {
        if (!cancelled) {
          setUsbStatus({ available: false, state: 'missing', ready: false, devices: [] });
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, USB_POLL_INTERVAL_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return usbStatus;
}
