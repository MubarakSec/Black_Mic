'use strict';

/**
 * Origin validation for the socket.io handshake (CSWSH defense).
 * Browsers always send Origin on WebSocket upgrades, so a malicious page
 * open in the user's browser can attempt to connect to the mic relay.
 * Non-browser clients (no Origin header) are allowed — origin checks can
 * only stop browser drive-by attacks, not raw TCP clients.
 */

function isSameHostOrigin(origin, host) {
  try {
    const originHost = new URL(origin).host.toLowerCase();
    return originHost === String(host || '').toLowerCase();
  } catch {
    return false;
  }
}

function isOriginAllowed(origin, host, corsOrigin) {
  if (!origin) return true;
  if (corsOrigin === true) return true;
  if (Array.isArray(corsOrigin)) return corsOrigin.includes(origin);
  return isSameHostOrigin(origin, host);
}

module.exports = { isOriginAllowed };
