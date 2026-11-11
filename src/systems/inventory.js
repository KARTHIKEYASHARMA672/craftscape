import { GAME_MODES, PLAYER_CONSTANTS } from '../core/constants.js';
import { ITEM, getItemDef } from '../core/items.js';
import { getFuelBurnTime, getSmeltResult } from './recipes.js';

export const INVENTORY_SLOTS = 36;
export const HOTBAR_SIZE = 9;
export const CHEST_SIZE = 27;
export const FURNACE_COOK_TIME = 10;

function cloneStack(slot) {
  if (!slot || slot.id == null || slot.count <= 0) return null;
  const copy = { id: slot.id, count: slot.count };
  if (slot.durability != null) {
    copy.durability = slot.durability;
  }
  return copy;
}

function sanitizeStack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const def = getItemDef(raw.id);
  if (!def) return null;
  const rawCount = Math.trunc(Number(raw.count));
  if (!Number.isFinite(rawCount) || rawCount <= 0) return null;
  const count = Math.min(def.stackSize ?? 64, rawCount);
  const stack = { id: def.id, count };
  if (def.maxDurability > 0) {
    const rawDur = raw.durability == null ? def.maxDurability : Math.trunc(Number(raw.durability));
    stack.durability = Math.max(1, Math.min(def.maxDurability, Number.isFinite(rawDur) ? rawDur : def.maxDurability));
  }
  return stack;
}

function createEmptyFurnace() {
  return {
    input: null,
    fuel: null,
    output: null,
    burnTime: 0,
    maxBurnTime: 0,
    cookProgress: 0,
  };
}

function cloneFurnace(furnace) {
  return {
    input: cloneStack(furnace.input),
    fuel: cloneStack(furnace.fuel),
    output: cloneStack(furnace.output),
    burnTime: furnace.burnTime ?? 0,
    maxBurnTime: furnace.maxBurnTime ?? 0,
    cookProgress: furnace.cookProgress ?? 0,
  };
}

export class InventorySystem {
  constructor() {
    this.slots = new Array(INVENTORY_SLOTS).fill(null);
    this.selectedHotbar = 0;
    this.health = PLAYER_CONSTANTS.MAX_HEALTH;
    this.hunger = PLAYER_CONSTANTS.MAX_HUNGER;
    this.oxygen = PLAYER_CONSTANTS.MAX_OXYGEN;
    this.furnaces = new Map();
    this.chests = new Map();
  }

  clear() {
    this.slots.fill(null);
  }

  giveStarterKit(mode = GAME_MODES.SURVIVAL) {
    this.clear();
    this.selectedHotbar = 0;

    if (mode === GAME_MODES.CREATIVE) {
      this.addItem(ITEM.GRASS, 64);
      this.addItem(ITEM.STONE, 64);
      this.addItem(ITEM.OAK_PLANKS, 64);
      this.addItem(ITEM.GLASS, 64);
      this.addItem(ITEM.BRICKS, 64);
      this.addItem(ITEM.GLOWSTONE, 64);
      this.addItem(ITEM.TORCH, 64);
      this.addItem(ITEM.DIAMOND_PICKAXE, 1);
      this.addItem(ITEM.TNT, 64);
      return;
    }

    this.addItem(ITEM.WOODEN_PICKAXE, 1);
    this.addItem(ITEM.WOODEN_AXE, 1);
    this.addItem(ITEM.TORCH, 8);
    this.addItem(ITEM.BREAD, 4);
    this.addItem(ITEM.OAK_PLANKS, 8);
  }

  addItem(id, count = 1, durability = null) {
    const def = getItemDef(id);
    if (!def) return 0;

    const desired = Math.trunc(Number(count));
    if (!Number.isFinite(desired) || desired <= 0) return 0;

    const maxStack = def.stackSize ?? 64;
    let remaining = desired;

    // Top up existing compatible stacks when stackable and not custom-damaged
    if (maxStack > 1 && durability == null) {
      for (let i = 0; i < INVENTORY_SLOTS && remaining > 0; i += 1) {
        const slot = this.slots[i];
        if (slot && slot.id === def.id && slot.count < maxStack) {
          const room = maxStack - slot.count;
          const transfer = Math.min(room, remaining);
          slot.count += transfer;
          remaining -= transfer;
        }
      }
    }

    // Fill empty slots
    for (let i = 0; i < INVENTORY_SLOTS && remaining > 0; i += 1) {
      if (this.slots[i] == null) {
        const chunk = Math.min(maxStack, remaining);
        const stack = { id: def.id, count: chunk };
        if (def.maxDurability > 0) {
          const initialDur = durability == null ? def.maxDurability : Math.trunc(Number(durability));
          stack.durability = Math.max(1, Math.min(def.maxDurability, initialDur));
        }
        this.slots[i] = stack;
        remaining -= chunk;
      }
    }

    return desired - remaining;
  }

  consumeSlot(index, count = 1) {
    if (index < 0 || index >= INVENTORY_SLOTS) return false;
    const slot = this.slots[index];
    const amount = Math.trunc(Number(count));
    if (!slot || !Number.isFinite(amount) || amount <= 0 || slot.count < amount) {
      return false;
    }
    slot.count -= amount;
    if (slot.count <= 0) {
      this.slots[index] = null;
    }
    return true;
  }

  countItem(id) {
    let total = 0;
    for (let i = 0; i < INVENTORY_SLOTS; i += 1) {
      const slot = this.slots[i];
      if (slot && slot.id === id) {
        total += slot.count;
      }
    }
    return total;
  }

  consumeItemById(id, count = 1) {
    let remaining = Math.trunc(Number(count));
    if (!Number.isFinite(remaining) || remaining <= 0) return false;
    if (this.countItem(id) < remaining) return false;

    for (let i = 0; i < INVENTORY_SLOTS && remaining > 0; i += 1) {
      const slot = this.slots[i];
      if (slot && slot.id === id) {
        const take = Math.min(slot.count, remaining);
        this.consumeSlot(i, take);
        remaining -= take;
      }
    }
    return true;
  }

  getSelectedStack() {
    return this.slots[this.selectedHotbar] ?? null;
  }

  selectHotbar(index) {
    if (!Number.isFinite(index)) return this.selectedHotbar;
    this.selectedHotbar = Math.max(0, Math.min(HOTBAR_SIZE - 1, Math.trunc(index)));
    return this.selectedHotbar;
  }

  cycleHotbar(delta) {
    if (!Number.isFinite(delta)) return this.selectedHotbar;
    const step = Math.trunc(delta);
    this.selectedHotbar = (((this.selectedHotbar + step) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    return this.selectedHotbar;
  }

  damageSelectedTool(amount = 1) {
    const slot = this.getSelectedStack();
    if (!slot) return { damaged: false, broken: false };

    const def = getItemDef(slot.id);
    if (!def || def.maxDurability <= 0) {
      return { damaged: false, broken: false };
    }

    const wear = Math.max(1, Math.trunc(Number(amount)) || 1);
    const currentDurability = slot.durability ?? def.maxDurability;
    const nextDurability = currentDurability - wear;

    if (nextDurability <= 0) {
      this.slots[this.selectedHotbar] = null;
      return { damaged: true, broken: true, itemId: def.id };
    }

    slot.durability = nextDurability;
    return {
      damaged: true,
      broken: false,
      durability: nextDurability,
      maxDurability: def.maxDurability,
    };
  }

  eatSelectedFood() {
    const slot = this.getSelectedStack();
    if (!slot) return false;

    const def = getItemDef(slot.id);
    if (!def || !def.hunger || def.hunger <= 0) return false;
    if (this.hunger >= PLAYER_CONSTANTS.MAX_HUNGER) return false;

    this.hunger = Math.min(PLAYER_CONSTANTS.MAX_HUNGER, this.hunger + def.hunger);
    this.consumeSlot(this.selectedHotbar, 1);
    return true;
  }

  getOrCreateFurnace(key) {
    if (!this.furnaces.has(key)) {
      this.furnaces.set(key, createEmptyFurnace());
    }
    return this.furnaces.get(key);
  }

  removeFurnace(key) {
    return this.furnaces.delete(key);
  }

  getOrCreateChest(key) {
    if (!this.chests.has(key)) {
      this.chests.set(key, new Array(CHEST_SIZE).fill(null));
    }
    return this.chests.get(key);
  }

  removeChest(key) {
    return this.chests.delete(key);
  }

  tickFurnaces(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return false;
    let changed = false;

    for (const furnace of this.furnaces.values()) {
      let remaining = dt;

      while (remaining > 1e-9) {
        const smeltId = furnace.input && furnace.input.count > 0 ? getSmeltResult(furnace.input.id) : null;
        const outputDef = smeltId != null ? getItemDef(smeltId) : null;
        const outputLimit = outputDef?.stackSize ?? 64;
        const canSmelt =
          smeltId != null &&
          (!furnace.output || (furnace.output.id === smeltId && furnace.output.count < outputLimit));

        if (furnace.burnTime <= 0 && canSmelt && furnace.fuel && furnace.fuel.count > 0) {
          const fuelSeconds = getFuelBurnTime(furnace.fuel.id);
          if (fuelSeconds > 0) {
            furnace.fuel.count -= 1;
            if (furnace.fuel.count <= 0) furnace.fuel = null;
            furnace.burnTime = fuelSeconds;
            furnace.maxBurnTime = fuelSeconds;
            changed = true;
          }
        }

        if (furnace.burnTime > 0) {
          let step = Math.min(remaining, furnace.burnTime);
          if (canSmelt) {
            const needed = Math.max(0, FURNACE_COOK_TIME - furnace.cookProgress);
            step = Math.min(step, needed);
            furnace.burnTime = Math.max(0, furnace.burnTime - step);
            furnace.cookProgress += step;
            changed = true;

            if (furnace.cookProgress >= FURNACE_COOK_TIME - 1e-9) {
              furnace.cookProgress = 0;
              if (!furnace.output) {
                furnace.output = { id: smeltId, count: 1 };
              } else {
                furnace.output.count += 1;
              }
              furnace.input.count -= 1;
              if (furnace.input.count <= 0) furnace.input = null;
            }
          } else {
            furnace.burnTime = Math.max(0, furnace.burnTime - step);
            if (furnace.cookProgress > 0) {
              furnace.cookProgress = 0;
            }
            changed = true;
          }

          if (furnace.burnTime <= 1e-9) {
            furnace.burnTime = 0;
            furnace.maxBurnTime = 0;
          }
          remaining -= step;
        } else {
          if (furnace.cookProgress > 0) {
            furnace.cookProgress = 0;
            changed = true;
          }
          if (furnace.maxBurnTime > 0) {
            furnace.maxBurnTime = 0;
            changed = true;
          }
          break;
        }
      }
    }

    return changed;
  }

  serialize() {
    const furnaces = {};
    for (const [key, furnace] of this.furnaces.entries()) {
      furnaces[key] = cloneFurnace(furnace);
    }

    const chests = {};
    for (const [key, slots] of this.chests.entries()) {
      chests[key] = slots.map(cloneStack);
    }

    return {
      slots: this.slots.map(cloneStack),
      selectedHotbar: this.selectedHotbar,
      health: this.health,
      hunger: this.hunger,
      oxygen: this.oxygen,
      furnaces,
      chests,
    };
  }

  deserialize(obj) {
    this.slots = new Array(INVENTORY_SLOTS).fill(null);
    this.selectedHotbar = 0;
    this.health = PLAYER_CONSTANTS.MAX_HEALTH;
    this.hunger = PLAYER_CONSTANTS.MAX_HUNGER;
    this.oxygen = PLAYER_CONSTANTS.MAX_OXYGEN;
    this.furnaces = new Map();
    this.chests = new Map();

    if (!obj || typeof obj !== 'object') return this;

    if (Array.isArray(obj.slots)) {
      for (let i = 0; i < INVENTORY_SLOTS && i < obj.slots.length; i += 1) {
        this.slots[i] = sanitizeStack(obj.slots[i]);
      }
    }

    if (Number.isFinite(obj.selectedHotbar)) {
      this.selectHotbar(obj.selectedHotbar);
    }
    if (Number.isFinite(obj.health)) {
      this.health = Math.max(0, Math.min(PLAYER_CONSTANTS.MAX_HEALTH, obj.health));
    }
    if (Number.isFinite(obj.hunger)) {
      this.hunger = Math.max(0, Math.min(PLAYER_CONSTANTS.MAX_HUNGER, obj.hunger));
    }
    if (Number.isFinite(obj.oxygen)) {
      this.oxygen = Math.max(0, Math.min(PLAYER_CONSTANTS.MAX_OXYGEN, obj.oxygen));
    }

    if (obj.furnaces && typeof obj.furnaces === 'object') {
      const entries = obj.furnaces instanceof Map ? obj.furnaces.entries() : Object.entries(obj.furnaces);
      for (const [key, f] of entries) {
        if (!f || typeof f !== 'object') continue;
        this.furnaces.set(key, {
          input: sanitizeStack(f.input),
          fuel: sanitizeStack(f.fuel),
          output: sanitizeStack(f.output),
          burnTime: Number.isFinite(f.burnTime) && f.burnTime > 0 ? f.burnTime : 0,
          maxBurnTime: Number.isFinite(f.maxBurnTime) && f.maxBurnTime > 0 ? f.maxBurnTime : 0,
          cookProgress: Number.isFinite(f.cookProgress) && f.cookProgress > 0 ? f.cookProgress : 0,
        });
      }
    }

    if (obj.chests && typeof obj.chests === 'object') {
      const entries = obj.chests instanceof Map ? obj.chests.entries() : Object.entries(obj.chests);
      for (const [key, rawSlots] of entries) {
        if (!Array.isArray(rawSlots)) continue;
        const chestSlots = new Array(CHEST_SIZE).fill(null);
        for (let i = 0; i < CHEST_SIZE && i < rawSlots.length; i += 1) {
          chestSlots[i] = sanitizeStack(rawSlots[i]);
        }
        this.chests.set(key, chestSlots);
      }
    }

    return this;
  }
}
