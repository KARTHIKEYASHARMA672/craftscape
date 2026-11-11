import { BLOCK, BLOCK_DEFINITIONS } from './blocks.js';

/**
 * Unified Item Registry.
 * Every placeable block (id < 100) is automatically registered as an item with stackSize 64.
 * Non-placeable tools, materials, ingots, and food items occupy IDs >= 100.
 */

export const ITEM = Object.freeze({
  ...BLOCK,
  STICK: 100,
  COAL: 101,
  IRON_INGOT: 102,
  GOLD_INGOT: 103,
  DIAMOND: 104,
  EMERALD: 105,
  REDSTONE: 106,
  BRICK_ITEM: 107,
  GUNPOWDER: 108,
  APPLE: 109,
  RAW_MEAT: 110,
  COOKED_MEAT: 111,
  BREAD: 112,

  WOODEN_PICKAXE: 120,
  STONE_PICKAXE: 121,
  IRON_PICKAXE: 122,
  DIAMOND_PICKAXE: 123,

  WOODEN_AXE: 124,
  STONE_AXE: 125,
  IRON_AXE: 126,
  DIAMOND_AXE: 127,

  WOODEN_SHOVEL: 128,
  STONE_SHOVEL: 129,
  IRON_SHOVEL: 130,
  DIAMOND_SHOVEL: 131,

  WOODEN_SWORD: 132,
  STONE_SWORD: 133,
  IRON_SWORD: 134,
  DIAMOND_SWORD: 135,
});

function makeTool(id, name, toolKind, tier, tierName, maxDurability, speedMultiplier, damage, color) {
  return Object.freeze({
    id,
    name,
    category: 'tool',
    placeable: false,
    stackSize: 1,
    toolKind,
    tier,
    tierName,
    maxDurability,
    speedMultiplier,
    damage,
    iconColor: color,
  });
}

function makeMaterial(id, name, iconType, iconColor, extra = {}) {
  return Object.freeze({
    id,
    name,
    category: extra.hunger ? 'food' : 'material',
    placeable: false,
    stackSize: 64,
    toolKind: null,
    tier: 0,
    maxDurability: 0,
    speedMultiplier: 1,
    damage: 1,
    iconType,
    iconColor,
    ...extra,
  });
}

const NON_BLOCK_ITEMS = [
  makeMaterial(ITEM.STICK, 'Stick', 'stick', '#9c7143'),
  makeMaterial(ITEM.COAL, 'Coal', 'gem', '#2d2f34', { fuelTime: 80 }),
  makeMaterial(ITEM.IRON_INGOT, 'Iron Ingot', 'ingot', '#d7dce0'),
  makeMaterial(ITEM.GOLD_INGOT, 'Gold Ingot', 'ingot', '#f2ca3c'),
  makeMaterial(ITEM.DIAMOND, 'Diamond', 'diamond', '#4ee6db'),
  makeMaterial(ITEM.EMERALD, 'Emerald', 'diamond', '#33c962'),
  makeMaterial(ITEM.REDSTONE, 'Redstone Dust', 'dust', '#d93030'),
  makeMaterial(ITEM.BRICK_ITEM, 'Brick', 'ingot', '#a64d3c'),
  makeMaterial(ITEM.GUNPOWDER, 'Gunpowder', 'dust', '#6b6d70'),
  makeMaterial(ITEM.APPLE, 'Apple', 'apple', '#d9342b', { hunger: 4 }),
  makeMaterial(ITEM.RAW_MEAT, 'Raw Mutton', 'meat', '#c45a54', { hunger: 3 }),
  makeMaterial(ITEM.COOKED_MEAT, 'Cooked Mutton', 'meat', '#8a4c2d', { hunger: 8 }),
  makeMaterial(ITEM.BREAD, 'Bread', 'bread', '#cc9245', { hunger: 5 }),

  makeTool(ITEM.WOODEN_PICKAXE, 'Wooden Pickaxe', 'pickaxe', 1, 'wood', 60, 2.0, 2, '#b58954'),
  makeTool(ITEM.STONE_PICKAXE, 'Stone Pickaxe', 'pickaxe', 2, 'stone', 132, 4.0, 3, '#8c9196'),
  makeTool(ITEM.IRON_PICKAXE, 'Iron Pickaxe', 'pickaxe', 3, 'iron', 251, 6.0, 4, '#d8dde2'),
  makeTool(ITEM.DIAMOND_PICKAXE, 'Diamond Pickaxe', 'pickaxe', 4, 'diamond', 1561, 8.5, 5, '#4ee6db'),

  makeTool(ITEM.WOODEN_AXE, 'Wooden Axe', 'axe', 1, 'wood', 60, 2.0, 3, '#b58954'),
  makeTool(ITEM.STONE_AXE, 'Stone Axe', 'axe', 2, 'stone', 132, 4.0, 4, '#8c9196'),
  makeTool(ITEM.IRON_AXE, 'Iron Axe', 'axe', 3, 'iron', 251, 6.0, 5, '#d8dde2'),
  makeTool(ITEM.DIAMOND_AXE, 'Diamond Axe', 'axe', 4, 'diamond', 1561, 8.5, 6, '#4ee6db'),

  makeTool(ITEM.WOODEN_SHOVEL, 'Wooden Shovel', 'shovel', 1, 'wood', 60, 2.0, 1.5, '#b58954'),
  makeTool(ITEM.STONE_SHOVEL, 'Stone Shovel', 'shovel', 2, 'stone', 132, 4.0, 2.5, '#8c9196'),
  makeTool(ITEM.IRON_SHOVEL, 'Iron Shovel', 'shovel', 3, 'iron', 251, 6.0, 3.5, '#d8dde2'),
  makeTool(ITEM.DIAMOND_SHOVEL, 'Diamond Shovel', 'shovel', 4, 'diamond', 1561, 8.5, 4.5, '#4ee6db'),

  makeTool(ITEM.WOODEN_SWORD, 'Wooden Sword', 'sword', 1, 'wood', 60, 1.5, 4, '#b58954'),
  makeTool(ITEM.STONE_SWORD, 'Stone Sword', 'sword', 2, 'stone', 132, 1.5, 5, '#8c9196'),
  makeTool(ITEM.IRON_SWORD, 'Iron Sword', 'sword', 3, 'iron', 251, 1.5, 6, '#d8dde2'),
  makeTool(ITEM.DIAMOND_SWORD, 'Diamond Sword', 'sword', 4, 'diamond', 1561, 1.5, 7, '#4ee6db'),
];

const blockItems = BLOCK_DEFINITIONS.filter((b) => b.id !== BLOCK.AIR && b.id !== BLOCK.WATER && b.id !== BLOCK.LAVA && b.id !== BLOCK.BEDROCK)
  .map((b) => Object.freeze({
    id: b.id,
    name: b.name,
    category: 'block',
    placeable: true,
    blockId: b.id,
    stackSize: 64,
    toolKind: null,
    tier: 0,
    maxDurability: 0,
    speedMultiplier: 1,
    damage: 1,
    mapColor: b.mapColor,
  }));

export const CREATIVE_ITEMS = Object.freeze([
  ...blockItems,
  ...NON_BLOCK_ITEMS,
]);

export const ITEM_BY_ID = Object.freeze({
  ...Object.fromEntries(
    BLOCK_DEFINITIONS.filter((b) => b.id !== BLOCK.AIR).map((b) => [
      b.id,
      Object.freeze({
        id: b.id,
        name: b.name,
        category: 'block',
        placeable: b.id !== BLOCK.WATER && b.id !== BLOCK.LAVA && b.id !== BLOCK.BEDROCK,
        blockId: b.id,
        stackSize: 64,
        toolKind: null,
        tier: 0,
        maxDurability: 0,
        speedMultiplier: 1,
        damage: 1,
        mapColor: b.mapColor,
      }),
    ]),
  ),
  ...Object.fromEntries(NON_BLOCK_ITEMS.map((item) => [item.id, item])),
});

export function getItemDef(id) {
  return ITEM_BY_ID[id] ?? null;
}

export function getItemByKey(nameOrKey) {
  if (!nameOrKey) return null;
  const upper = String(nameOrKey).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (ITEM[upper] !== undefined) return ITEM_BY_ID[ITEM[upper]] ?? null;
  const lower = String(nameOrKey).trim().toLowerCase();
  return Object.values(ITEM_BY_ID).find((it) => it.name.toLowerCase() === lower) ?? null;
}

/**
 * Compute mining duration in seconds for breaking blockId with heldItemId.
 */
export function computeBreakTime(blockDef, heldItemId) {
  if (!blockDef || !Number.isFinite(blockDef.hardness)) return Infinity;
  if (blockDef.hardness <= 0.06) return 0.08;

  const tool = getItemDef(heldItemId);
  const matchesTool = tool && tool.toolKind && (blockDef.tool === 'any' || blockDef.tool === tool.toolKind);
  const canHarvest = blockDef.minTier === 0 || (matchesTool && tool.tier >= blockDef.minTier);

  let speedMultiplier = 1;
  if (matchesTool) {
    speedMultiplier = tool.speedMultiplier;
  }
  const baseFactor = canHarvest ? 1.5 : 5.0;
  return Math.max(0.08, (blockDef.hardness * baseFactor) / speedMultiplier);
}

export function canHarvestBlock(blockDef, heldItemId) {
  if (!blockDef || blockDef.dropId == null) return false;
  if (blockDef.minTier === 0) return true;
  const tool = getItemDef(heldItemId);
  if (!tool || !tool.toolKind) return false;
  if (blockDef.tool !== 'any' && blockDef.tool !== tool.toolKind) return false;
  return tool.tier >= blockDef.minTier;
}
