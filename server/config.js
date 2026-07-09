'use strict';

const DEFAULT_PORT = 3001;
const DEFAULT_MAX_SOCKET_PAYLOAD_MB = 5;

function readNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function readPositiveNumber(value, fallback) {
  const parsed = readNumber(value, fallback);
  if (parsed <= 0) return fallback;
  return parsed;
}

function readInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed;
}

function readPositiveInteger(value, fallback) {
  const parsed = readInteger(value, fallback);
  if (parsed <= 0) return fallback;
  return parsed;
}

module.exports = {
  port: readPositiveInteger(process.env.PORT, DEFAULT_PORT),
  maxSocketPayloadBytes: readPositiveNumber(process.env.BMS_MAX_SOCKET_PAYLOAD_MB, DEFAULT_MAX_SOCKET_PAYLOAD_MB) * 1024 * 1024,
};
