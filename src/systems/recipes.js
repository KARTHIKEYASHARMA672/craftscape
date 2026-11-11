import { ITEM, getItemDef } from '../core/items.js';

export const INGREDIENT_TAG = Object.freeze({
  ANY_PLANKS: 'tag:any_planks',
});

const TAG_MEMBERS = Object.freeze({
  [INGREDIENT_TAG.ANY_PLANKS]: Object.freeze([ITEM.OAK_PLANKS, ITEM.BIRCH_PLANKS]),
});

export function matchesIngredient(itemId, expected) {
  if (itemId == null || expected == null) return false;
  if (typeof expected === 'string') {
    const members = TAG_MEMBERS[expected];
    return Array.isArray(members) ? members.includes(itemId) : false;
  }
  return itemId === expected;
}

export function getIngredientOptions(expected) {
  if (typeof expected === 'string') {
    return TAG_MEMBERS[expected] ?? [];
  }
  return expected != null ? [expected] : [];
}

function defineShaped({ id, name, category, pattern, key, output, count = 1, mirrored = false }) {
  const height = pattern.length;
  const width = Math.max(...pattern.map((row) => row.length));
  const rows = pattern.map((row) => {
    const cells = [];
    for (let c = 0; c < width; c += 1) {
      const ch = row[c] ?? ' ';
      cells.push(ch === ' ' ? null : key[ch]);
    }
    return Object.freeze(cells);
  });

  const ingredients = [];
  for (const row of rows) {
    for (const cell of row) {
      if (cell != null) ingredients.push(cell);
    }
  }

  return Object.freeze({
    id,
    name: name ?? getItemDef(output)?.name ?? id,
    category,
    type: 'shaped',
    width,
    height,
    minGridSize: Math.max(width, height) <= 2 ? 2 : 3,
    mirrored,
    rows: Object.freeze(rows),
    ingredients: Object.freeze(ingredients),
    output: Object.freeze({ id: output, count }),
  });
}

function defineShapeless({ id, name, category, ingredients, output, count = 1, displayPattern = null }) {
  return Object.freeze({
    id,
    name: name ?? getItemDef(output)?.name ?? id,
    category,
    type: 'shapeless',
    width: ingredients.length <= 1 ? 1 : ingredients.length <= 4 ? 2 : 3,
    height: ingredients.length <= 2 ? 1 : ingredients.length <= 4 ? 2 : 3,
    minGridSize: ingredients.length <= 4 ? 2 : 3,
    mirrored: false,
    rows: null,
    displayPattern,
    ingredients: Object.freeze([...ingredients]),
    output: Object.freeze({ id: output, count }),
  });
}

const P = INGREDIENT_TAG.ANY_PLANKS;

export const RECIPES = Object.freeze([
  // Wood processing (1x1 shapeless)
  defineShapeless({
    id: 'oak_planks',
    category: 'building',
    ingredients: [ITEM.OAK_LOG],
    output: ITEM.OAK_PLANKS,
    count: 4,
  }),
  defineShapeless({
    id: 'birch_planks',
    category: 'building',
    ingredients: [ITEM.BIRCH_LOG],
    output: ITEM.BIRCH_PLANKS,
    count: 4,
  }),
  defineShapeless({
    id: 'spruce_planks',
    name: 'Oak Planks (Spruce)',
    category: 'building',
    ingredients: [ITEM.SPRUCE_LOG],
    output: ITEM.OAK_PLANKS,
    count: 4,
  }),

  // Core utility & crafting stations
  defineShaped({
    id: 'sticks',
    category: 'materials',
    pattern: ['P', 'P'],
    key: { P },
    output: ITEM.STICK,
    count: 4,
  }),
  defineShaped({
    id: 'crafting_table',
    category: 'stations',
    pattern: ['PP', 'PP'],
    key: { P },
    output: ITEM.CRAFTING_TABLE,
    count: 1,
  }),
  defineShaped({
    id: 'furnace',
    category: 'stations',
    pattern: ['CCC', 'C C', 'CCC'],
    key: { C: ITEM.COBBLESTONE },
    output: ITEM.FURNACE,
    count: 1,
  }),
  defineShaped({
    id: 'chest',
    category: 'stations',
    pattern: ['PPP', 'P P', 'PPP'],
    key: { P },
    output: ITEM.CHEST,
    count: 1,
  }),
  defineShaped({
    id: 'torch',
    category: 'lighting',
    pattern: ['C', 'S'],
    key: { C: ITEM.COAL, S: ITEM.STICK },
    output: ITEM.TORCH,
    count: 4,
  }),

  // Wooden tools
  defineShaped({
    id: 'wooden_pickaxe',
    category: 'tools',
    pattern: ['PPP', ' S ', ' S '],
    key: { P, S: ITEM.STICK },
    output: ITEM.WOODEN_PICKAXE,
  }),
  defineShaped({
    id: 'wooden_axe',
    category: 'tools',
    pattern: ['PP', 'PS', ' S'],
    key: { P, S: ITEM.STICK },
    output: ITEM.WOODEN_AXE,
    mirrored: true,
  }),
  defineShaped({
    id: 'wooden_shovel',
    category: 'tools',
    pattern: ['P', 'S', 'S'],
    key: { P, S: ITEM.STICK },
    output: ITEM.WOODEN_SHOVEL,
  }),
  defineShaped({
    id: 'wooden_sword',
    category: 'tools',
    pattern: ['P', 'P', 'S'],
    key: { P, S: ITEM.STICK },
    output: ITEM.WOODEN_SWORD,
  }),

  // Stone tools
  defineShaped({
    id: 'stone_pickaxe',
    category: 'tools',
    pattern: ['MMM', ' S ', ' S '],
    key: { M: ITEM.COBBLESTONE, S: ITEM.STICK },
    output: ITEM.STONE_PICKAXE,
  }),
  defineShaped({
    id: 'stone_axe',
    category: 'tools',
    pattern: ['MM', 'MS', ' S'],
    key: { M: ITEM.COBBLESTONE, S: ITEM.STICK },
    output: ITEM.STONE_AXE,
    mirrored: true,
  }),
  defineShaped({
    id: 'stone_shovel',
    category: 'tools',
    pattern: ['M', 'S', 'S'],
    key: { M: ITEM.COBBLESTONE, S: ITEM.STICK },
    output: ITEM.STONE_SHOVEL,
  }),
  defineShaped({
    id: 'stone_sword',
    category: 'tools',
    pattern: ['M', 'M', 'S'],
    key: { M: ITEM.COBBLESTONE, S: ITEM.STICK },
    output: ITEM.STONE_SWORD,
  }),

  // Iron tools
  defineShaped({
    id: 'iron_pickaxe',
    category: 'tools',
    pattern: ['MMM', ' S ', ' S '],
    key: { M: ITEM.IRON_INGOT, S: ITEM.STICK },
    output: ITEM.IRON_PICKAXE,
  }),
  defineShaped({
    id: 'iron_axe',
    category: 'tools',
    pattern: ['MM', 'MS', ' S'],
    key: { M: ITEM.IRON_INGOT, S: ITEM.STICK },
    output: ITEM.IRON_AXE,
    mirrored: true,
  }),
  defineShaped({
    id: 'iron_shovel',
    category: 'tools',
    pattern: ['M', 'S', 'S'],
    key: { M: ITEM.IRON_INGOT, S: ITEM.STICK },
    output: ITEM.IRON_SHOVEL,
  }),
  defineShaped({
    id: 'iron_sword',
    category: 'tools',
    pattern: ['M', 'M', 'S'],
    key: { M: ITEM.IRON_INGOT, S: ITEM.STICK },
    output: ITEM.IRON_SWORD,
  }),

  // Diamond tools
  defineShaped({
    id: 'diamond_pickaxe',
    category: 'tools',
    pattern: ['MMM', ' S ', ' S '],
    key: { M: ITEM.DIAMOND, S: ITEM.STICK },
    output: ITEM.DIAMOND_PICKAXE,
  }),
  defineShaped({
    id: 'diamond_axe',
    category: 'tools',
    pattern: ['MM', 'MS', ' S'],
    key: { M: ITEM.DIAMOND, S: ITEM.STICK },
    output: ITEM.DIAMOND_AXE,
    mirrored: true,
  }),
  defineShaped({
    id: 'diamond_shovel',
    category: 'tools',
    pattern: ['M', 'S', 'S'],
    key: { M: ITEM.DIAMOND, S: ITEM.STICK },
    output: ITEM.DIAMOND_SHOVEL,
  }),
  defineShaped({
    id: 'diamond_sword',
    category: 'tools',
    pattern: ['M', 'M', 'S'],
    key: { M: ITEM.DIAMOND, S: ITEM.STICK },
    output: ITEM.DIAMOND_SWORD,
  }),

  // Building & Decorative blocks
  defineShaped({
    id: 'sandstone',
    category: 'building',
    pattern: ['SS', 'SS'],
    key: { S: ITEM.SAND },
    output: ITEM.SANDSTONE,
    count: 1,
  }),
  defineShaped({
    id: 'stone_bricks',
    category: 'building',
    pattern: ['SS', 'SS'],
    key: { S: ITEM.STONE },
    output: ITEM.STONE_BRICKS,
    count: 4,
  }),
  defineShaped({
    id: 'bricks',
    category: 'building',
    pattern: ['BB', 'BB'],
    key: { B: ITEM.BRICK_ITEM },
    output: ITEM.BRICKS,
    count: 1,
  }),
  defineShaped({
    id: 'bookshelf',
    category: 'building',
    pattern: ['PPP', 'WWW', 'PPP'],
    key: { P, W: ITEM.WOOL_WHITE },
    output: ITEM.BOOKSHELF,
    count: 1,
  }),
  defineShapeless({
    id: 'wool_red',
    category: 'building',
    ingredients: [ITEM.WOOL_WHITE, ITEM.POPPY],
    output: ITEM.WOOL_RED,
    count: 1,
  }),
  defineShapeless({
    id: 'glowstone',
    category: 'lighting',
    ingredients: [ITEM.REDSTONE, ITEM.REDSTONE, ITEM.REDSTONE, ITEM.REDSTONE, ITEM.GOLD_INGOT],
    output: ITEM.GLOWSTONE,
    count: 1,
    displayPattern: [
      [null, ITEM.REDSTONE, null],
      [ITEM.REDSTONE, ITEM.GOLD_INGOT, ITEM.REDSTONE],
      [null, ITEM.REDSTONE, null],
    ],
  }),
  defineShaped({
    id: 'tnt',
    category: 'utility',
    pattern: ['GSG', 'SGS', 'GSG'],
    key: { G: ITEM.GUNPOWDER, S: ITEM.SAND },
    output: ITEM.TNT,
    count: 1,
  }),

  // Compacting & unpacking mineral blocks
  defineShaped({
    id: 'iron_block',
    category: 'blocks',
    pattern: ['III', 'III', 'III'],
    key: { I: ITEM.IRON_INGOT },
    output: ITEM.IRON_BLOCK,
    count: 1,
  }),
  defineShapeless({
    id: 'unpack_iron_block',
    name: 'Iron Ingot (Unpack)',
    category: 'materials',
    ingredients: [ITEM.IRON_BLOCK],
    output: ITEM.IRON_INGOT,
    count: 9,
  }),
  defineShaped({
    id: 'gold_block',
    category: 'blocks',
    pattern: ['GGG', 'GGG', 'GGG'],
    key: { G: ITEM.GOLD_INGOT },
    output: ITEM.GOLD_BLOCK,
    count: 1,
  }),
  defineShapeless({
    id: 'unpack_gold_block',
    name: 'Gold Ingot (Unpack)',
    category: 'materials',
    ingredients: [ITEM.GOLD_BLOCK],
    output: ITEM.GOLD_INGOT,
    count: 9,
  }),
  defineShaped({
    id: 'diamond_block',
    category: 'blocks',
    pattern: ['DDD', 'DDD', 'DDD'],
    key: { D: ITEM.DIAMOND },
    output: ITEM.DIAMOND_BLOCK,
    count: 1,
  }),
  defineShapeless({
    id: 'unpack_diamond_block',
    name: 'Diamond (Unpack)',
    category: 'materials',
    ingredients: [ITEM.DIAMOND_BLOCK],
    output: ITEM.DIAMOND,
    count: 9,
  }),
]);

function matchShaped(recipe, gridSlots, gridSize, bounds) {
  const { minRow, minCol, width, height } = bounds;
  if (recipe.width !== width || recipe.height !== height) return false;

  const checkOrientation = (flipHorizontal) => {
    for (let r = 0; r < height; r += 1) {
      for (let c = 0; c < width; c += 1) {
        const slot = gridSlots[(minRow + r) * gridSize + (minCol + c)];
        const expected = recipe.rows[r][flipHorizontal ? width - 1 - c : c];
        const hasItem = Boolean(slot && slot.count >= 1);
        if (expected == null) {
          if (hasItem) return false;
        } else if (!hasItem || !matchesIngredient(slot.id, expected)) {
          return false;
        }
      }
    }
    return true;
  };

  if (checkOrientation(false)) return true;
  if (recipe.mirrored && checkOrientation(true)) return true;
  return false;
}

function matchShapelessList(ingredients, items, idx = 0, usedMask = 0) {
  if (idx === items.length) return true;
  const itemId = items[idx].id;
  for (let j = 0; j < ingredients.length; j += 1) {
    if ((usedMask & (1 << j)) !== 0) continue;
    if (matchesIngredient(itemId, ingredients[j])) {
      if (matchShapelessList(ingredients, items, idx + 1, usedMask | (1 << j))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Match a 2x2 or 3x3 crafting grid against registered recipes.
 * @param {Array<{id: number, count: number} | null>} gridSlots
 * @param {2|3} [gridSize]
 * @returns {{ recipe: object, result: { id: number, count: number }, consumeIndices: number[] } | null}
 */
export function matchCraftingRecipe(gridSlots, gridSize) {
  if (!Array.isArray(gridSlots) || gridSlots.length === 0) return null;
  const size = gridSize ?? (gridSlots.length === 4 ? 2 : 3);
  if (size !== 2 && size !== 3) return null;

  const nonEmpty = [];
  let minRow = size;
  let maxRow = -1;
  let minCol = size;
  let maxCol = -1;

  for (let i = 0; i < size * size; i += 1) {
    const slot = gridSlots[i];
    if (slot && slot.count >= 1 && slot.id != null) {
      const row = Math.floor(i / size);
      const col = i % size;
      nonEmpty.push({ index: i, id: slot.id });
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }
  }

  if (nonEmpty.length === 0) return null;

  const bounds = {
    minRow,
    minCol,
    width: maxCol - minCol + 1,
    height: maxRow - minRow + 1,
  };
  const consumeIndices = nonEmpty.map((entry) => entry.index);

  for (const recipe of RECIPES) {
    if (recipe.minGridSize > size) continue;
    if (recipe.type === 'shaped') {
      if (matchShaped(recipe, gridSlots, size, bounds)) {
        return {
          recipe,
          result: { id: recipe.output.id, count: recipe.output.count },
          consumeIndices,
        };
      }
    } else if (nonEmpty.length === recipe.ingredients.length) {
      if (matchShapelessList(recipe.ingredients, nonEmpty)) {
        return {
          recipe,
          result: { id: recipe.output.id, count: recipe.output.count },
          consumeIndices,
        };
      }
    }
  }

  return null;
}

export const SMELTING_RECIPES = Object.freeze({
  [ITEM.IRON_ORE]: ITEM.IRON_INGOT,
  [ITEM.GOLD_ORE]: ITEM.GOLD_INGOT,
  [ITEM.SAND]: ITEM.GLASS,
  [ITEM.COBBLESTONE]: ITEM.STONE,
  [ITEM.CLAY]: ITEM.BRICK_ITEM,
  [ITEM.RAW_MEAT]: ITEM.COOKED_MEAT,
  [ITEM.OAK_LOG]: ITEM.COAL,
  [ITEM.BIRCH_LOG]: ITEM.COAL,
  [ITEM.SPRUCE_LOG]: ITEM.COAL,
});

export const FUEL_BURN_SECONDS = Object.freeze({
  [ITEM.COAL]: 80,
  [ITEM.OAK_PLANKS]: 15,
  [ITEM.BIRCH_PLANKS]: 15,
  [ITEM.OAK_LOG]: 15,
  [ITEM.BIRCH_LOG]: 15,
  [ITEM.SPRUCE_LOG]: 15,
  [ITEM.STICK]: 5,
  [ITEM.CRAFTING_TABLE]: 15,
});

export function getSmeltResult(itemId) {
  if (itemId == null) return null;
  return SMELTING_RECIPES[itemId] ?? null;
}

export function getFuelBurnTime(itemId) {
  if (itemId == null) return 0;
  return FUEL_BURN_SECONDS[itemId] ?? 0;
}
