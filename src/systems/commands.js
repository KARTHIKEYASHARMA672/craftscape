import { GAME_MODES, PLAYER_CONSTANTS } from '../core/constants.js';
import { getItemByKey } from '../core/items.js';

const TIME_PRESETS = Object.freeze({
  sunrise: 0.25,
  dawn: 0.24,
  day: 0.48,
  noon: 0.5,
  sunset: 0.75,
  dusk: 0.77,
  night: 0.95,
  midnight: 0.98,
});

const HELP_TEXT =
  'Commands: /help, /gamemode <survival|creative>, /time set <day|sunset|night|0..1>, /tp <x> <y> <z>, /give <item> [count], /seed, /heal, /clear';

function parseCoordinate(token, base = 0) {
  if (!token) return NaN;
  if (token === '~') return base;
  if (token.startsWith('~')) {
    const offset = Number(token.slice(1));
    return Number.isFinite(offset) ? base + offset : NaN;
  }
  const num = Number(token);
  return Number.isFinite(num) ? num : NaN;
}

export function executeSlashCommand(raw, ctx = {}) {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Invalid command input.', action: null };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: 'Empty command. Type /help for a list.', action: null };
  }

  if (!trimmed.startsWith('/')) {
    return { ok: false, message: 'Commands must start with "/". Type /help for available commands.', action: null };
  }

  const tokens = trimmed.slice(1).trim().split(/\s+/);
  const cmd = (tokens[0] ?? '').toLowerCase();
  const args = tokens.slice(1);

  switch (cmd) {
    case 'help':
    case '?': {
      return {
        ok: true,
        message: HELP_TEXT,
        action: { type: 'help' },
      };
    }

    case 'gamemode':
    case 'gm': {
      const arg = (args[0] ?? '').toLowerCase();
      let mode = null;
      if (arg === 'survival' || arg === 's' || arg === '0') mode = GAME_MODES.SURVIVAL;
      else if (arg === 'creative' || arg === 'c' || arg === '1') mode = GAME_MODES.CREATIVE;

      if (!mode) {
        return { ok: false, message: 'Usage: /gamemode <survival|creative>', action: null };
      }

      if (typeof ctx.setGameMode === 'function') {
        ctx.setGameMode(mode);
      } else if (ctx && typeof ctx === 'object' && 'gameMode' in ctx) {
        ctx.gameMode = mode;
      }

      return {
        ok: true,
        message: `Game mode set to ${mode}.`,
        action: { type: 'gamemode', mode },
      };
    }

    case 'time': {
      if ((args[0] ?? '').toLowerCase() !== 'set' || args.length < 2) {
        return { ok: false, message: 'Usage: /time set <day|sunset|night|0..1>', action: null };
      }

      const rawVal = args[1].toLowerCase();
      let timeVal = null;
      let label = rawVal;

      if (Object.hasOwn(TIME_PRESETS, rawVal)) {
        timeVal = TIME_PRESETS[rawVal];
      } else {
        const parsed = Number(rawVal);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          timeVal = parsed;
          label = parsed.toFixed(2);
        }
      }

      if (timeVal === null) {
        return { ok: false, message: 'Usage: /time set <day|sunset|night|0..1>', action: null };
      }

      if (typeof ctx.setTime === 'function') {
        ctx.setTime(timeVal);
      } else if (ctx && typeof ctx === 'object' && 'timeOfDay' in ctx) {
        ctx.timeOfDay = timeVal;
      }

      return {
        ok: true,
        message: `Time set to ${label} (${timeVal.toFixed(2)}).`,
        action: { type: 'time', time: timeVal, label },
      };
    }

    case 'tp':
    case 'teleport': {
      if (args.length !== 3) {
        return { ok: false, message: 'Usage: /tp <x> <y> <z>', action: null };
      }

      const basePos = ctx?.player?.position ?? { x: 0, y: 64, z: 0 };
      const x = parseCoordinate(args[0], basePos.x ?? 0);
      const y = parseCoordinate(args[1], basePos.y ?? 64);
      const z = parseCoordinate(args[2], basePos.z ?? 0);

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return { ok: false, message: 'Coordinates must be valid numbers or "~" offsets.', action: null };
      }
      if (y < -32 || y > 256) {
        return { ok: false, message: 'Target Y must be between -32 and 256.', action: null };
      }

      if (typeof ctx.teleport === 'function') {
        ctx.teleport(x, y, z);
      } else if (ctx?.player?.position) {
        ctx.player.position.x = x;
        ctx.player.position.y = y;
        ctx.player.position.z = z;
      }

      return {
        ok: true,
        message: `Teleported to (${x}, ${y}, ${z}).`,
        action: { type: 'tp', x, y, z },
      };
    }

    case 'give': {
      if (args.length === 0) {
        return { ok: false, message: 'Usage: /give <item> [count]', action: null };
      }

      let count = 1;
      let itemTokens = args;
      if (args.length >= 2 && /^-?\d+$/.test(args[args.length - 1])) {
        count = Number(args[args.length - 1]);
        itemTokens = args.slice(0, -1);
      }

      if (!Number.isInteger(count) || count < 1 || count > 640) {
        return { ok: false, message: 'Count must be an integer between 1 and 640.', action: null };
      }

      const itemQuery = itemTokens.join('_');
      const itemDef = getItemByKey(itemQuery);
      if (!itemDef) {
        return { ok: false, message: `Unknown item "${itemTokens.join(' ')}".`, action: null };
      }

      let added = count;
      if (ctx?.inventory && typeof ctx.inventory.addItem === 'function') {
        added = ctx.inventory.addItem(itemDef.id, count);
      }

      return {
        ok: true,
        message:
          added === count
            ? `Gave ${count} × ${itemDef.name}.`
            : `Gave ${added}/${count} × ${itemDef.name} (inventory full).`,
        action: {
          type: 'give',
          itemId: itemDef.id,
          itemName: itemDef.name,
          count,
          added,
        },
      };
    }

    case 'seed': {
      const seed = ctx?.seed ?? ctx?.worldSeed ?? null;
      if (seed === null || seed === undefined) {
        return { ok: true, message: 'World seed unavailable.', action: { type: 'seed', seed: null } };
      }
      return {
        ok: true,
        message: `World seed: ${seed}`,
        action: { type: 'seed', seed },
      };
    }

    case 'heal': {
      if (typeof ctx.heal === 'function') {
        ctx.heal();
      } else if (ctx?.inventory) {
        ctx.inventory.health = PLAYER_CONSTANTS.MAX_HEALTH;
        ctx.inventory.hunger = PLAYER_CONSTANTS.MAX_HUNGER;
        ctx.inventory.oxygen = PLAYER_CONSTANTS.MAX_OXYGEN;
      }

      return {
        ok: true,
        message: 'Restored health, hunger, and oxygen.',
        action: { type: 'heal' },
      };
    }

    case 'clear': {
      if (typeof ctx.clearInventory === 'function') {
        ctx.clearInventory();
      } else if (ctx?.inventory && typeof ctx.inventory.clear === 'function') {
        ctx.inventory.clear();
      } else if (Array.isArray(ctx?.inventory?.slots)) {
        ctx.inventory.slots.fill(null);
      }

      return {
        ok: true,
        message: 'Cleared inventory.',
        action: { type: 'clear' },
      };
    }

    default: {
      return {
        ok: false,
        message: `Unknown command "/${cmd}". Type /help for available commands.`,
        action: null,
      };
    }
  }
}
