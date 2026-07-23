import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildEasyEffectsRouteCommands,
  routeEasyEffects,
} = require('../../server/easyeffects-router');

const SOURCE_NODE = 'BlackMic_ROOM';
const CHANNEL_COUNT = 2;
const COMMANDS_PER_CHANNEL = 3;

describe('EasyEffects routing', () => {
  it('builds disconnect-and-connect commands for both channels', () => {
    const commands = buildEasyEffectsRouteCommands(SOURCE_NODE);

    expect(commands).toHaveLength(CHANNEL_COUNT * COMMANDS_PER_CHANNEL);
    expect(commands.filter(command => command.required).map(command => command.args)).toEqual([
      ['BlackMic_ROOM:capture_FL', 'ee_sie_rnnoise:input_FL'],
      ['BlackMic_ROOM:capture_FR', 'ee_sie_rnnoise:input_FR'],
    ]);
  });

  it('rejects unsafe source node names', () => {
    expect(buildEasyEffectsRouteCommands('BlackMic_ROOM;echo unsafe')).toEqual([]);
  });

  it('reports success only when both required links connect', async () => {
    const runCommand = vi.fn(async args => !args.includes('BlackMic_ROOM:capture_FR'));

    await expect(routeEasyEffects(SOURCE_NODE, runCommand)).resolves.toBe(false);
    expect(runCommand).toHaveBeenCalledTimes(CHANNEL_COUNT * COMMANDS_PER_CHANNEL);
  });
});
