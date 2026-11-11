import { describe, it, expect, vi } from 'vitest';
import { GAME_MODES, PLAYER_CONSTANTS } from '../src/core/constants.js';
import { ITEM } from '../src/core/items.js';
import {
  FUEL_BURN_SECONDS,
  SMELTING_RECIPES,
  getFuelBurnTime,
  getSmeltResult,
  matchCraftingRecipe,
} from '../src/systems/recipes.js';
import { FURNACE_COOK_TIME, InventorySystem } from '../src/systems/inventory.js';
import { executeSlashCommand } from '../src/systems/commands.js';
import { WorldStorage, parseWorldSave, serializeWorldSave } from '../src/systems/storage.js';

function slot(id, count = 1) {
  return { id, count };
}

describe('Crafting & Smelting Recipes', () => {
  it('crafts planks from oak, birch, and spruce logs in 2x2 and 3x3 grids', () => {
    const oakMatch = matchCraftingRecipe([null, null, null, slot(ITEM.OAK_LOG, 2)], 2);
    expect(oakMatch).not.toBeNull();
    expect(oakMatch.result).toEqual({ id: ITEM.OAK_PLANKS, count: 4 });
    expect(oakMatch.consumeIndices).toEqual([3]);

    const birchMatch = matchCraftingRecipe(
      [null, null, null, null, slot(ITEM.BIRCH_LOG), null, null, null, null],
      3,
    );
    expect(birchMatch).not.toBeNull();
    expect(birchMatch.result).toEqual({ id: ITEM.BIRCH_PLANKS, count: 4 });
    expect(birchMatch.consumeIndices).toEqual([4]);

    const spruceMatch = matchCraftingRecipe([slot(ITEM.SPRUCE_LOG), null, null, null], 2);
    expect(spruceMatch?.result).toEqual({ id: ITEM.OAK_PLANKS, count: 4 });
  });

  it('matches vertical sticks and torches at any column offset in 2x2 and 3x3', () => {
    // Column 1 of 2x2 with mixed oak + birch planks
    const stick2x2 = matchCraftingRecipe(
      [null, slot(ITEM.OAK_PLANKS), null, slot(ITEM.BIRCH_PLANKS)],
      2,
    );
    expect(stick2x2?.result).toEqual({ id: ITEM.STICK, count: 4 });
    expect(stick2x2?.consumeIndices).toEqual([1, 3]);

    // Column 2 (rightmost) in 3x3 bottom-shifted
    const torch3x3 = matchCraftingRecipe(
      [
        null, null, null,
        null, null, slot(ITEM.COAL),
        null, null, slot(ITEM.STICK),
      ],
      3,
    );
    expect(torch3x3?.result).toEqual({ id: ITEM.TORCH, count: 4 });
    expect(torch3x3?.consumeIndices).toEqual([5, 8]);
  });

  it('crafts crafting table, chest, and furnace', () => {
    const table = matchCraftingRecipe(
      [slot(ITEM.BIRCH_PLANKS), slot(ITEM.BIRCH_PLANKS), slot(ITEM.BIRCH_PLANKS), slot(ITEM.BIRCH_PLANKS)],
      2,
    );
    expect(table?.result).toEqual({ id: ITEM.CRAFTING_TABLE, count: 1 });

    const chest = matchCraftingRecipe(
      [
        slot(ITEM.OAK_PLANKS), slot(ITEM.BIRCH_PLANKS), slot(ITEM.OAK_PLANKS),
        slot(ITEM.OAK_PLANKS), null, slot(ITEM.BIRCH_PLANKS),
        slot(ITEM.BIRCH_PLANKS), slot(ITEM.OAK_PLANKS), slot(ITEM.OAK_PLANKS),
      ],
      3,
    );
    expect(chest?.result).toEqual({ id: ITEM.CHEST, count: 1 });

    const furnace = matchCraftingRecipe(
      [
        slot(ITEM.COBBLESTONE), slot(ITEM.COBBLESTONE), slot(ITEM.COBBLESTONE),
        slot(ITEM.COBBLESTONE), null, slot(ITEM.COBBLESTONE),
        slot(ITEM.COBBLESTONE), slot(ITEM.COBBLESTONE), slot(ITEM.COBBLESTONE),
      ],
      3,
    );
    expect(furnace?.result).toEqual({ id: ITEM.FURNACE, count: 1 });
  });

  it('crafts all 4 tool tiers and supports column offsets and mirrored axes', () => {
    const woodPick = matchCraftingRecipe(
      [
        slot(ITEM.OAK_PLANKS), slot(ITEM.OAK_PLANKS), slot(ITEM.OAK_PLANKS),
        null, slot(ITEM.STICK), null,
        null, slot(ITEM.STICK), null,
      ],
      3,
    );
    expect(woodPick?.result).toEqual({ id: ITEM.WOODEN_PICKAXE, count: 1 });

    // Shifted right-column stone sword
    const stoneSword = matchCraftingRecipe(
      [
        null, null, slot(ITEM.COBBLESTONE),
        null, null, slot(ITEM.COBBLESTONE),
        null, null, slot(ITEM.STICK),
      ],
      3,
    );
    expect(stoneSword?.result).toEqual({ id: ITEM.STONE_SWORD, count: 1 });
    expect(stoneSword?.consumeIndices).toEqual([2, 5, 8]);

    // Mirrored iron axe shifted to rightmost 2 columns
    const ironAxeMirrored = matchCraftingRecipe(
      [
        null, slot(ITEM.IRON_INGOT), slot(ITEM.IRON_INGOT),
        null, slot(ITEM.STICK), slot(ITEM.IRON_INGOT),
        null, slot(ITEM.STICK), null,
      ],
      3,
    );
    expect(ironAxeMirrored?.result).toEqual({ id: ITEM.IRON_AXE, count: 1 });

    // Center column diamond shovel
    const diamondShovel = matchCraftingRecipe(
      [
        null, slot(ITEM.DIAMOND), null,
        null, slot(ITEM.STICK), null,
        null, slot(ITEM.STICK), null,
      ],
      3,
    );
    expect(diamondShovel?.result).toEqual({ id: ITEM.DIAMOND_SHOVEL, count: 1 });
  });

  it('crafts building, glowstone, TNT, wool dye, and block compress/unpack recipes', () => {
    expect(
      matchCraftingRecipe([slot(ITEM.SAND), slot(ITEM.SAND), slot(ITEM.SAND), slot(ITEM.SAND)], 2)?.result,
    ).toEqual({ id: ITEM.SANDSTONE, count: 1 });

    expect(
      matchCraftingRecipe([slot(ITEM.STONE), slot(ITEM.STONE), slot(ITEM.STONE), slot(ITEM.STONE)], 2)?.result,
    ).toEqual({ id: ITEM.STONE_BRICKS, count: 4 });

    expect(
      matchCraftingRecipe(
        [slot(ITEM.BRICK_ITEM), slot(ITEM.BRICK_ITEM), slot(ITEM.BRICK_ITEM), slot(ITEM.BRICK_ITEM)],
        2,
      )?.result,
    ).toEqual({ id: ITEM.BRICKS, count: 1 });

    const glowstone = matchCraftingRecipe(
      [
        null, slot(ITEM.REDSTONE), null,
        slot(ITEM.REDSTONE), slot(ITEM.GOLD_INGOT), slot(ITEM.REDSTONE),
        null, slot(ITEM.REDSTONE), null,
      ],
      3,
    );
    expect(glowstone?.result).toEqual({ id: ITEM.GLOWSTONE, count: 1 });

    const tnt = matchCraftingRecipe(
      [
        slot(ITEM.GUNPOWDER), slot(ITEM.SAND), slot(ITEM.GUNPOWDER),
        slot(ITEM.SAND), slot(ITEM.GUNPOWDER), slot(ITEM.SAND),
        slot(ITEM.GUNPOWDER), slot(ITEM.SAND), slot(ITEM.GUNPOWDER),
      ],
      3,
    );
    expect(tnt?.result).toEqual({ id: ITEM.TNT, count: 1 });

    const bookshelf = matchCraftingRecipe(
      [
        slot(ITEM.OAK_PLANKS), slot(ITEM.OAK_PLANKS), slot(ITEM.OAK_PLANKS),
        slot(ITEM.WOOL_WHITE), slot(ITEM.WOOL_WHITE), slot(ITEM.WOOL_WHITE),
        slot(ITEM.BIRCH_PLANKS), slot(ITEM.BIRCH_PLANKS), slot(ITEM.BIRCH_PLANKS),
      ],
      3,
    );
    expect(bookshelf?.result).toEqual({ id: ITEM.BOOKSHELF, count: 1 });

    const redWool = matchCraftingRecipe([slot(ITEM.WOOL_WHITE), slot(ITEM.POPPY), null, null], 2);
    expect(redWool?.result).toEqual({ id: ITEM.WOOL_RED, count: 1 });

    const diamondBlock = matchCraftingRecipe(new Array(9).fill(null).map(() => slot(ITEM.DIAMOND)), 3);
    expect(diamondBlock?.result).toEqual({ id: ITEM.DIAMOND_BLOCK, count: 1 });

    const unpackedDiamond = matchCraftingRecipe([slot(ITEM.DIAMOND_BLOCK), null, null, null], 2);
    expect(unpackedDiamond?.result).toEqual({ id: ITEM.DIAMOND, count: 9 });
  });

  it('rejects patterns with extra stray items and verifies smelting/fuel helpers', () => {
    const invalid = matchCraftingRecipe(
      [slot(ITEM.OAK_LOG), slot(ITEM.DIRT), null, null],
      2,
    );
    expect(invalid).toBeNull();

    expect(SMELTING_RECIPES[ITEM.IRON_ORE]).toBe(ITEM.IRON_INGOT);
    expect(getSmeltResult(ITEM.IRON_ORE)).toBe(ITEM.IRON_INGOT);
    expect(getSmeltResult(ITEM.RAW_MEAT)).toBe(ITEM.COOKED_MEAT);
    expect(getSmeltResult(ITEM.DIRT)).toBeNull();

    expect(FUEL_BURN_SECONDS[ITEM.COAL]).toBe(80);
    expect(getFuelBurnTime(ITEM.COAL)).toBe(80);
    expect(getFuelBurnTime(ITEM.STICK)).toBe(5);
    expect(getFuelBurnTime(ITEM.DIAMOND)).toBe(0);
  });
});

describe('InventorySystem', () => {
  it('stacks items up to 64 and splits overflow into subsequent slots', () => {
    const inv = new InventorySystem();
    const added = inv.addItem(ITEM.COBBLESTONE, 130);
    expect(added).toBe(130);
    expect(inv.slots[0]).toEqual({ id: ITEM.COBBLESTONE, count: 64 });
    expect(inv.slots[1]).toEqual({ id: ITEM.COBBLESTONE, count: 64 });
    expect(inv.slots[2]).toEqual({ id: ITEM.COBBLESTONE, count: 2 });

    expect(inv.consumeSlot(2, 2)).toBe(true);
    expect(inv.slots[2]).toBeNull();
    expect(inv.consumeSlot(2, 1)).toBe(false);
  });

  it('tracks tool durability and breaks tools when durability reaches zero', () => {
    const inv = new InventorySystem();
    inv.addItem(ITEM.WOODEN_PICKAXE, 1);
    inv.selectHotbar(0);
    expect(inv.getSelectedStack().durability).toBe(60);

    const hit = inv.damageSelectedTool(1);
    expect(hit.damaged).toBe(true);
    expect(hit.broken).toBe(false);
    expect(inv.getSelectedStack().durability).toBe(59);

    const breakHit = inv.damageSelectedTool(59);
    expect(breakHit.broken).toBe(true);
    expect(inv.getSelectedStack()).toBeNull();
  });

  it('restores hunger when eating food and refuses when already full', () => {
    const inv = new InventorySystem();
    inv.addItem(ITEM.COOKED_MEAT, 2);
    inv.selectHotbar(0);

    expect(inv.eatSelectedFood()).toBe(false); // already at 20

    inv.hunger = 10;
    expect(inv.eatSelectedFood()).toBe(true);
    expect(inv.hunger).toBe(18);
    expect(inv.slots[0].count).toBe(1);

    expect(inv.eatSelectedFood()).toBe(true);
    expect(inv.hunger).toBe(PLAYER_CONSTANTS.MAX_HUNGER);
    expect(inv.slots[0]).toBeNull();
  });

  it('smelts iron ore using coal over furnace ticks and serializes cleanly', () => {
    const inv = new InventorySystem();
    const furnace = inv.getOrCreateFurnace('4,64,-2');
    furnace.input = { id: ITEM.IRON_ORE, count: 2 };
    furnace.fuel = { id: ITEM.COAL, count: 1 };

    inv.tickFurnaces(FURNACE_COOK_TIME);
    expect(furnace.output).toEqual({ id: ITEM.IRON_INGOT, count: 1 });
    expect(furnace.input).toEqual({ id: ITEM.IRON_ORE, count: 1 });
    expect(furnace.fuel).toBeNull();
    expect(furnace.burnTime).toBeCloseTo(80 - FURNACE_COOK_TIME, 5);

    inv.tickFurnaces(FURNACE_COOK_TIME);
    expect(furnace.output).toEqual({ id: ITEM.IRON_INGOT, count: 2 });
    expect(furnace.input).toBeNull();

    const chest = inv.getOrCreateChest('1,64,1');
    chest[0] = { id: ITEM.DIAMOND, count: 3 };

    inv.giveStarterKit(GAME_MODES.SURVIVAL);
    const saved = inv.serialize();
    const restored = new InventorySystem().deserialize(saved);
    expect(restored.slots[0]).toEqual(inv.slots[0]);
    expect(restored.getOrCreateChest('1,64,1')[0]).toEqual({ id: ITEM.DIAMOND, count: 3 });
  });
});

describe('Slash Commands', () => {
  it('executes /gamemode, /time set, /tp, /give, /seed, /heal, /clear, and /help', () => {
    const inv = new InventorySystem();
    inv.health = 8;
    inv.hunger = 6;
    const setGameMode = vi.fn();
    const setTime = vi.fn();
    const teleport = vi.fn();
    const ctx = {
      inventory: inv,
      seed: 424242,
      player: { position: { x: 0, y: 64, z: 0 } },
      setGameMode,
      setTime,
      teleport,
    };

    expect(executeSlashCommand('/help', ctx).ok).toBe(true);

    const gmRes = executeSlashCommand('/gamemode creative', ctx);
    expect(gmRes.ok).toBe(true);
    expect(gmRes.action).toEqual({ type: 'gamemode', mode: GAME_MODES.CREATIVE });
    expect(setGameMode).toHaveBeenCalledWith(GAME_MODES.CREATIVE);

    const timeRes = executeSlashCommand('/time set night', ctx);
    expect(timeRes.ok).toBe(true);
    expect(timeRes.action.type).toBe('time');
    expect(timeRes.action.time).toBeGreaterThan(0.5);
    expect(setTime).toHaveBeenCalledTimes(1);

    const tpRes = executeSlashCommand('/tp 10 80 -5', ctx);
    expect(tpRes.ok).toBe(true);
    expect(tpRes.action).toEqual({ type: 'tp', x: 10, y: 80, z: -5 });
    expect(teleport).toHaveBeenCalledWith(10, 80, -5);

    const giveRes = executeSlashCommand('/give diamond 12', ctx);
    expect(giveRes.ok).toBe(true);
    expect(giveRes.action.itemId).toBe(ITEM.DIAMOND);
    expect(inv.countItem(ITEM.DIAMOND)).toBe(12);

    const seedRes = executeSlashCommand('/seed', ctx);
    expect(seedRes.ok).toBe(true);
    expect(seedRes.action.seed).toBe(424242);

    const healRes = executeSlashCommand('/heal', ctx);
    expect(healRes.ok).toBe(true);
    expect(inv.health).toBe(20);
    expect(inv.hunger).toBe(20);

    const clearRes = executeSlashCommand('/clear', ctx);
    expect(clearRes.ok).toBe(true);
    expect(inv.countItem(ITEM.DIAMOND)).toBe(0);
  });

  it('returns clean errors for invalid commands and arguments', () => {
    expect(executeSlashCommand('/unknowncmd').ok).toBe(false);
    expect(executeSlashCommand('/gamemode spectator').ok).toBe(false);
    expect(executeSlashCommand('/time set 2.5').ok).toBe(false);
    expect(executeSlashCommand('/tp 10 abc 5').ok).toBe(false);
    expect(executeSlashCommand('/give nonexistent_ore 5').ok).toBe(false);
    expect(executeSlashCommand('/give diamond 0').ok).toBe(false);
    expect(executeSlashCommand('not a slash command').ok).toBe(false);
  });
});

describe('WorldStorage & Save Serialization', () => {
  it('round-trips Map, Set, Date, and 32KB chunk Uint8Array deltas cleanly through JSON', () => {
    const chunkBytes = new Uint8Array(32768);
    chunkBytes[0] = 1;
    chunkBytes[1542] = 27;
    chunkBytes[32767] = 50;
    const modifiedBlocks = new Map([
      ['0,64,0', 11],
      ['-3,70,12', 33],
    ]);
    const visitedChunks = new Set(['0,0', '1,-1']);

    const raw = serializeWorldSave({
      id: 'world-test',
      name: 'Oak Ridge',
      seed: 9001,
      savedAt: new Date('2026-11-11T00:00:00Z'),
      chunkBytes,
      modifiedBlocks,
      visitedChunks,
    });

    expect(typeof raw).toBe('string');
    const restored = parseWorldSave(raw);
    expect(restored.savedAt).toBe('2026-11-11T00:00:00.000Z');
    expect(restored.modifiedBlocks).toBeInstanceOf(Map);
    expect(restored.modifiedBlocks.get('-3,70,12')).toBe(33);
    expect(restored.visitedChunks).toBeInstanceOf(Set);
    expect(restored.visitedChunks.has('1,-1')).toBe(true);
    expect(restored.chunkBytes).toBeInstanceOf(Uint8Array);
    expect(restored.chunkBytes.length).toBe(32768);
    expect(restored.chunkBytes[0]).toBe(1);
    expect(restored.chunkBytes[1542]).toBe(27);
    expect(restored.chunkBytes[32767]).toBe(50);
  });

  it('supports save, list, load, and delete in memory fallback mode', async () => {
    const storage = new WorldStorage({ indexedDB: null });
    expect(storage.isUsingMemoryFallback()).toBe(true);

    const inv = new InventorySystem();
    inv.giveStarterKit(GAME_MODES.SURVIVAL);

    await storage.saveWorld({
      id: 'w1',
      name: 'First Valley',
      seed: 111,
      gameMode: GAME_MODES.SURVIVAL,
      updatedAt: 1000,
      inventory: inv,
      deltas: new Map([['0,0', new Uint8Array([5, 6, 7])]]),
    });

    await storage.saveWorld({
      id: 'w2',
      name: 'Creative Sky',
      seed: 222,
      gameMode: GAME_MODES.CREATIVE,
      updatedAt: 2000,
    });

    const worlds = await storage.listWorlds();
    expect(worlds).toHaveLength(2);
    expect(worlds[0].id).toBe('w2');
    expect(worlds[1].id).toBe('w1');

    const loaded = await storage.loadWorld('w1');
    expect(loaded).not.toBeNull();
    expect(loaded.name).toBe('First Valley');
    expect(loaded.deltas).toBeInstanceOf(Map);
    expect(Array.from(loaded.deltas.get('0,0'))).toEqual([5, 6, 7]);
    expect(loaded.inventory.slots[0].id).toBe(ITEM.WOODEN_PICKAXE);

    expect(await storage.deleteWorld('w1')).toBe(true);
    expect(await storage.deleteWorld('w1')).toBe(false);
    expect(await storage.loadWorld('w1')).toBeNull();
    expect(await storage.listWorlds()).toHaveLength(1);
  });
});
