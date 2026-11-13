'use strict';

const LOG_LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const DEFAULT_LOG_LEVEL = 'info';
const LEVEL_ENV_VAR = 'BMS_LOG_LEVEL';

function resolveLevel(levelName) {
  const normalized = String(levelName || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LOG_LEVEL_WEIGHT, normalized)) {
    return normalized;
  }
  return DEFAULT_LOG_LEVEL;
}

const activeLevel = resolveLevel(process.env[LEVEL_ENV_VAR]);

function shouldLog(level) {
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[activeLevel];
}

function sinkFor(level) {
  if (level === 'error') return console.error.bind(console);
  if (level === 'warn') return console.warn.bind(console);
  return console.log.bind(console);
}

function emit(level, args) {
  if (!shouldLog(level)) return;
  const timestamp = new Date().toISOString();
  sinkFor(level)(`[${timestamp}] [BMS:${level.toUpperCase()}]`, ...args);
}

const logger = {
  debug: (...args) => emit('debug', args),
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
};

module.exports = {
  logger,
  resolveLevel,
  activeLevel,
  LOG_LEVEL_WEIGHT,
};
