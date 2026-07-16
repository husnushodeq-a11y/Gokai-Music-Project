import type { Band } from 'shoukaku';
import type { Command, CommandContext, CommandMeta } from '@/types';
import { reply, requireController } from '@/util/commandHelpers';

/**
 * Audio-effect (filter) commands — Jockie's "Effects" surface, implemented via
 * Shoukaku's Lavalink filter API (accessed through `player.shoukaku`). Each
 * preset is applied atomically; `filter clear` removes all effects.
 */

const CONTROL_REQ = { guildOnly: true, sessionRequired: true, voiceRequired: true, sameVoiceRequired: true } as const;

/** A bass-boost equalizer curve (low bands lifted). */
const BASS_BOOST: Band[] = [0, 1, 2, 3].map((band) => ({ band, gain: 0.25 }));

/** The available presets and how each maps onto Shoukaku filter calls. */
const PRESETS: Record<string, (p: import('shoukaku').Player) => Promise<void>> = {
  bassboost: async (p) => { await p.setEqualizer(BASS_BOOST); },
  nightcore: async (p) => { await p.setTimescale({ speed: 1.2, pitch: 1.2, rate: 1 }); },
  vaporwave: async (p) => { await p.setTimescale({ speed: 0.85, pitch: 0.85, rate: 1 }); },
  slowed: async (p) => { await p.setTimescale({ speed: 0.8, pitch: 1, rate: 1 }); },
  speed: async (p) => { await p.setTimescale({ speed: 1.3, pitch: 1, rate: 1 }); },
  '8d': async (p) => { await p.setRotation({ rotationHz: 0.2 }); },
  tremolo: async (p) => { await p.setTremolo({ frequency: 4, depth: 0.75 }); },
  vibrato: async (p) => { await p.setVibrato({ frequency: 4, depth: 0.75 }); },
  karaoke: async (p) => { await p.setKaraoke({ level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 }); },
};

const PRESET_NAMES = Object.keys(PRESETS);

const filterCommand: Command = {
  meta: {
    name: 'filter',
    aliases: ['filters', 'effect'],
    description: 'Apply an audio effect (bassboost, nightcore, 8d, …)',
    category: 'filters',
    subCategory: 'Effects',
    usage: `filter <${PRESET_NAMES.join('|')}|clear>`,
    examples: ['m!filter bassboost', 'm!filter nightcore', 'm!filter clear'],
  } as CommandMeta,
  requirements: CONTROL_REQ,
  execute: async (ctx: CommandContext) => {
    const ctrl = await requireController(ctx);
    if (!ctrl) return;

    const name = ctx.args[0]?.toLowerCase();
    const player = ctrl.session.player.shoukaku;

    if (!name) {
      return void reply(ctx.message, `🎛️ Available effects: ${PRESET_NAMES.map((n) => `\`${n}\``).join(', ')}, \`clear\`.`);
    }
    if (name === 'clear' || name === 'off' || name === 'reset') {
      await player.clearFilters().catch(() => undefined);
      return void reply(ctx.message, '🎛️ Cleared all audio effects.');
    }

    const preset = PRESETS[name];
    if (!preset) {
      return void reply(ctx.message, `⚠️ Unknown effect. Choose: ${PRESET_NAMES.map((n) => `\`${n}\``).join(', ')} or \`clear\`.`);
    }
    // Clearing first keeps presets from stacking unexpectedly.
    await player.clearFilters().catch(() => undefined);
    await preset(player).catch(() => undefined);
    await reply(ctx.message, `🎛️ Applied the **${name}** effect.`);
  },
};

/** All filter commands, exported for registration. */
export const FILTER_COMMANDS: readonly Command[] = [filterCommand];
