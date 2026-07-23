'use strict';

const { spawn } = require('child_process');

const SOURCE_NODE_PATTERN = /^[A-Za-z0-9_]+$/;
const FALLBACK_SOURCE_NODE = 'alsa_input.platform-snd_aloop.0.analog-stereo';
const EFFECTS_ENTRY_NODE = 'ee_sie_rnnoise';
const AUDIO_CHANNELS = ['FL', 'FR'];

function buildEasyEffectsRouteCommands(sourceNodeName) {
  if (!SOURCE_NODE_PATTERN.test(sourceNodeName)) return [];

  return AUDIO_CHANNELS.flatMap((channel) => {
    const sourcePort = `${sourceNodeName}:capture_${channel}`;
    const fallbackPort = `${FALLBACK_SOURCE_NODE}:capture_${channel}`;
    const effectsPort = `${EFFECTS_ENTRY_NODE}:input_${channel}`;

    return [
      { args: ['-d', fallbackPort, effectsPort], required: false },
      { args: ['-d', sourcePort, effectsPort], required: false },
      { args: [sourcePort, effectsPort], required: true },
    ];
  });
}

function runPwLink(args) {
  return new Promise((resolve) => {
    const process = spawn('pw-link', args, { stdio: 'ignore' });
    process.on('close', code => resolve(code === 0));
    process.on('error', () => resolve(false));
  });
}

async function routeEasyEffects(sourceNodeName, runCommand = runPwLink) {
  const commands = buildEasyEffectsRouteCommands(sourceNodeName);
  if (commands.length === 0) return false;

  const requiredResults = [];
  for (const command of commands) {
    const succeeded = await runCommand(command.args);
    if (command.required) requiredResults.push(succeeded);
  }
  return requiredResults.every(Boolean);
}

module.exports = { buildEasyEffectsRouteCommands, routeEasyEffects };
