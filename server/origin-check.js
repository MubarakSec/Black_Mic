'use strict';

/**
 * Origin validation for the socket.io handshake (CSWSH defense).
 *
 * Threat model: cross-site WebSocket hijacking from a browser page.
 * Browsers always send Origin on WS upgrades, so a drive-by page cannot
 * open the mic relay. Non-browser clients (no Origin header) are allowed.
 *
 * Loopback binds (USB mode): default-deny everything except loopback
 * literals — this defeats DNS-rebinding attacks that point a hostname at
 * 127.0.0.1 and try to ride the Host header.
 *
 * LAN binds (--lan): Origin must match the request Host (same-origin) or
 * an explicit allowlist. A rebinding attacker who controls both Host and
 * Origin of THEIR OWN request is out of scope — stop them with a pairing
 * token (see README) or BMS_ALLOWED_ORIGINS.
 */

function parseHostname(host) {
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host.toLowerCase() : host.slice(0, end + 1).toLowerCase();
  }
  return host.split(':')[0].toLowerCase();
}

function isLoopbackHost(host) {
  const h = parseHostname(host);
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
}

function isSameHostOrigin(origin, host) {
  try {
    const originHost = new URL(origin).host.toLowerCase();
    return originHost === String(host || '').toLowerCase();
  } catch {
    return false;
  }
}

function isLoopbackOrigin(origin, port) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (!isLoopbackHost(url.host)) return false;
    const originPort = url.port || (url.protocol === 'https:' ? '443' : '80');
    return String(port) === originPort;
  } catch {
    return false;
  }
}

function isOriginAllowed(origin, host, corsOrigin, boundHost, port) {
  if (!origin) return true;
  if (corsOrigin === true) return true;
  if (Array.isArray(corsOrigin)) return corsOrigin.includes(origin);
  if (isLoopbackHost(boundHost)) return isLoopbackOrigin(origin, port);
  return isSameHostOrigin(origin, host);
}

module.exports = { isOriginAllowed, isLoopbackHost, isSameHostOrigin };
