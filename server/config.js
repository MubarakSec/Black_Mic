'use strict';

const DEFAULT_PORT = 3001;
const DEFAULT_MAX_SOCKET_PAYLOAD_MB = 5;
const PRODUCTION_ENV = 'production';

function readAllowedOrigins(value, environment) {
  const origins = String(value || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (origins.length > 0) return origins;
  if (environment === PRODUCTION_ENV) return false;
  return true;
}

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
  corsOrigin: readAllowedOrigins(process.env.BMS_ALLOWED_ORIGINS, process.env.NODE_ENV),
  port: readPositiveInteger(process.env.PORT, DEFAULT_PORT),
  maxSocketPayloadBytes: readPositiveNumber(process.env.BMS_MAX_SOCKET_PAYLOAD_MB, DEFAULT_MAX_SOCKET_PAYLOAD_MB) * 1024 * 1024,
};
