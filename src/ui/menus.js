import { DIFFICULTIES, GAME_MODES } from '../core/constants.js';
import { CREATIVE_ITEMS, getItemDef } from '../core/items.js';
import { FURNACE_COOK_TIME } from '../systems/inventory.js';
import {
  RECIPES,
  getFuelBurnTime,
  getIngredientOptions,
  getSmeltResult,
  matchCraftingRecipe,
} from '../systems/recipes.js';
import { mountItemVisual, patchSlotElement } from './hud.js';

function formatTimestamp(ts) {
  if (!ts) return 'New';
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Saved';
  }
}

function describeStackTooltip(stack) {
  if (!stack) return null;
  const def = getItemDef(stack.id);
  if (!def) return null;

  const metaParts = [];
  if (def.category === 'tool') {
    const dur = stack.durability ?? def.maxDurability;
    metaParts.push(`Speed ×${def.speedMultiplier}`, `Dmg ${def.damage}`, `Durability ${dur}/${def.maxDurability}`);
  } else if (def.hunger) {
    metaParts.push(`Food (+${def.hunger} hunger)`);
  } else if (def.placeable) {
    metaParts.push('Placeable Block');
  } else {
    metaParts.push('Material');
  }

  const fuel = getFuelBurnTime(def.id);
  if (fuel > 0) metaParts.push(`Fuel ${fuel}s`);
  const smelt = getSmeltResult(def.id);
  if (smelt != null) {
    const outDef = getItemDef(smelt);
    if (outDef) metaParts.push(`Smelts → ${outDef.name}`);
  }

  return { name: def.name, meta: metaParts.join(' · ') };
}

function describeRecipeIngredients(recipe) {
  const counts = new Map();
  for (const ing of recipe.ingredients) {
    const key = typeof ing === 'string' ? ing : String(ing);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [];
  for (const [key, qty] of counts.entries()) {
    if (key.startsWith('tag:')) {
      parts.push(`${qty}× Planks`);
    } else {
      const def = getItemDef(Number(key));
      parts.push(`${qty}× ${def ? def.name : key}`);
    }
  }
  return parts.join(', ');
}

function canPullRecipeFromInventory(recipe, inventory, craftGrid) {
  if (!inventory) return false;
  // Build virtual pool combining player inventory + items currently sitting in craftGrid
  const pool = new Map();
  for (const slot of inventory.slots) {
    if (slot && slot.count > 0) {
      pool.set(slot.id, (pool.get(slot.id) ?? 0) + slot.count);
    }
  }
  for (const slot of craftGrid) {
    if (slot && slot.count > 0) {
      pool.set(slot.id, (pool.get(slot.id) ?? 0) + slot.count);
    }
  }

  for (const ing of recipe.ingredients) {
    const options = getIngredientOptions(ing);
    let picked = false;
    for (const optId of options) {
      const avail = pool.get(optId) ?? 0;
      if (avail > 0) {
        pool.set(optId, avail - 1);
        picked = true;
        break;
      }
    }
    if (!picked) return false;
  }
  return true;
}

function pullOneIngredientFromInventory(expected, inventory) {
  const options = getIngredientOptions(expected);
  for (const optId of options) {
    for (let i = 0; i < inventory.slots.length; i += 1) {
      const slot = inventory.slots[i];
      if (slot && slot.id === optId && slot.count > 0) {
        inventory.consumeSlot(i, 1);
        return { id: optId, count: 1 };
      }
    }
  }
  return null;
}

function canFitInInventory(inventory, id, count) {
  const def = getItemDef(id);
  if (!def) return false;
  const maxStack = def.stackSize ?? 64;
  let remaining = count;
  for (const slot of inventory.slots) {
    if (!slot) {
      remaining -= maxStack;
    } else if (slot.id === id && maxStack > 1 && slot.durability == null) {
      remaining -= Math.max(0, maxStack - slot.count);
    }
    if (remaining <= 0) return true;
  }
  return false;
}

export class GameMenus {
  constructor(container, { renderIcon, handlers = {} } = {}) {
    this.container = container;
    this.renderIcon = renderIcon;
    this.handlers = handlers;

    this._activeScreen = null; // null | 'title' | 'pause' | 'container'
    this._containerState = null;
    this._cursorStack = null;
    this._craftGrid = [];
    this._activeTab = 'craft'; // 'craft' | 'creative'
    this._recipeFilterCraftable = false;
    this._recipeSearch = '';
    this._creativeCategory = 'all';
    this._creativeSearch = '';
    this._pendingDeleteId = null;

    this._slotBindings = [];
    this._recipeCards = [];
    this._furnaceRefs = null;
    this._craftOutputEl = null;

    this._createFloatingLayers();
  }

  _createFloatingLayers() {
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'cs-cursor-stack';

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'cs-tooltip';
    this.tooltipNameEl = document.createElement('div');
    this.tooltipNameEl.className = 'cs-tooltip-name';
    this.tooltipMetaEl = document.createElement('div');
    this.tooltipMetaEl.className = 'cs-tooltip-meta';
    this.tooltipEl.append(this.tooltipNameEl, this.tooltipMetaEl);

    this._onPointerMove = (event) => {
      if (!this.isOpen()) return;
      const x = event.clientX;
      const y = event.clientY;
      this.cursorEl.style.left = `${x}px`;
      this.cursorEl.style.top = `${y}px`;

      if (this.tooltipEl.classList.contains('is-visible')) {
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 720;
        const tx = Math.min(vw - 270, x + 16);
        const ty = Math.min(vh - 76, y + 16);
        this.tooltipEl.style.left = `${Math.max(8, tx)}px`;
        this.tooltipEl.style.top = `${Math.max(8, ty)}px`;
      }
    };
  }

  _playClick() {
    this.handlers.onPlayClickSound?.();
  }

  _notifyInventoryChanged() {
    this.handlers.onInventoryChanged?.();
  }

  isOpen() {
    return this._activeScreen !== null;
  }

  getActiveScreen() {
    return this._activeScreen;
  }

  close() {
    if (this._activeScreen === 'container') {
      this._returnTempItemsToInventory();
      this._notifyInventoryChanged();
      this.handlers.onCloseContainer?.();
    }
    this._activeScreen = null;
    this._containerState = null;
    this._cursorStack = null;
    this._craftGrid = [];
    this._slotBindings = [];
    this._recipeCards = [];
    this._furnaceRefs = null;
    this._craftOutputEl = null;
    this._pendingDeleteId = null;

    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this._onPointerMove);
    }
    this.cursorEl.classList.remove('is-visible');
    this.tooltipEl.classList.remove('is-visible');
    this.container.replaceChildren();
  }

  _returnTempItemsToInventory() {
    const inv = this._containerState?.inventory;
    if (!inv) return;

    if (this._cursorStack) {
      inv.addItem(this._cursorStack.id, this._cursorStack.count, this._cursorStack.durability ?? null);
      this._cursorStack = null;
    }
    for (let i = 0; i < this._craftGrid.length; i += 1) {
      const slot = this._craftGrid[i];
      if (slot && slot.count > 0) {
        inv.addItem(slot.id, slot.count, slot.durability ?? null);
      }
      this._craftGrid[i] = null;
    }
  }

  showTitle(worlds = [], defaults = {}) {
    this.close();
    this._activeScreen = 'title';

    let selectedMode = defaults.gameMode ?? GAME_MODES.SURVIVAL;
    let selectedDiff = defaults.difficulty ?? DIFFICULTIES.NORMAL;

    const overlay = document.createElement('div');
    overlay.className = 'cs-overlay cs-overlay--title';

    const shell = document.createElement('section');
    shell.className = 'cs-panel cs-title-shell';

    // Left Column: Brand + New World Form
    const left = document.createElement('div');

    const brand = document.createElement('div');
    brand.className = 'cs-brand';
    const badge = document.createElement('div');
    badge.className = 'cs-brand-badge';
    badge.textContent = 'CS';
    const titleBox = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.className = 'cs-brand-title';
    h1.textContent = 'CRAFTSCAPE';
    const sub = document.createElement('p');
    sub.className = 'cs-brand-sub';
    sub.textContent = 'Tactile Mineral & Timber Voxel Sandbox';
    titleBox.append(h1, sub);
    brand.append(badge, titleBox);

    const nameGroup = document.createElement('div');
    nameGroup.className = 'cs-form-group';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'cs-label';
    nameLabel.textContent = 'World Name';
    const nameInput = document.createElement('input');
    nameInput.className = 'cs-input';
    nameInput.type = 'text';
    nameInput.maxLength = 40;
    nameInput.value = defaults.name ?? 'Emerald Valley';
    nameInput.placeholder = 'Enter world name...';
    nameGroup.append(nameLabel, nameInput);

    const seedGroup = document.createElement('div');
    seedGroup.className = 'cs-form-group';
    const seedLabel = document.createElement('label');
    seedLabel.className = 'cs-label';
    seedLabel.textContent = 'World Seed (optional)';
    const seedRow = document.createElement('div');
    seedRow.className = 'cs-seed-row';
    const seedInput = document.createElement('input');
    seedInput.className = 'cs-input cs-mono';
    seedInput.type = 'text';
    seedInput.value = defaults.seed != null ? String(defaults.seed) : '';
    seedInput.placeholder = 'Random seed if blank';
    const diceBtn = document.createElement('button');
    diceBtn.type = 'button';
    diceBtn.className = 'cs-btn';
    diceBtn.textContent = 'Random';
    diceBtn.addEventListener('click', () => {
      this._playClick();
      seedInput.value = String(Math.floor(100000 + Math.random() * 899999));
    });
    seedRow.append(seedInput, diceBtn);
    seedGroup.append(seedLabel, seedRow);

    const modeGroup = document.createElement('div');
    modeGroup.className = 'cs-form-group';
    const modeLabel = document.createElement('span');
    modeLabel.className = 'cs-label';
    modeLabel.textContent = 'Game Mode';
    const modeSeg = document.createElement('div');
    modeSeg.className = 'cs-segmented';

    const survBtn = document.createElement('button');
    survBtn.type = 'button';
    survBtn.className = `cs-pill ${selectedMode === GAME_MODES.SURVIVAL ? 'is-active' : ''}`;
    survBtn.textContent = 'Survival';

    const creaBtn = document.createElement('button');
    creaBtn.type = 'button';
    creaBtn.className = `cs-pill cs-pill--gold ${selectedMode === GAME_MODES.CREATIVE ? 'is-active' : ''}`;
    creaBtn.textContent = 'Creative';

    survBtn.addEventListener('click', () => {
      this._playClick();
      selectedMode = GAME_MODES.SURVIVAL;
      survBtn.classList.add('is-active');
      creaBtn.classList.remove('is-active');
    });
    creaBtn.addEventListener('click', () => {
      this._playClick();
      selectedMode = GAME_MODES.CREATIVE;
      creaBtn.classList.add('is-active');
      survBtn.classList.remove('is-active');
    });
    modeSeg.append(survBtn, creaBtn);
    modeGroup.append(modeLabel, modeSeg);

    const diffGroup = document.createElement('div');
    diffGroup.className = 'cs-form-group';
    const diffLabel = document.createElement('span');
    diffLabel.className = 'cs-label';
    diffLabel.textContent = 'Difficulty';
    const diffSeg = document.createElement('div');
    diffSeg.className = 'cs-segmented';

    const normBtn = document.createElement('button');
    normBtn.type = 'button';
    normBtn.className = `cs-pill ${selectedDiff === DIFFICULTIES.NORMAL ? 'is-active' : ''}`;
    normBtn.textContent = 'Normal';

    const peaceBtn = document.createElement('button');
    peaceBtn.type = 'button';
    peaceBtn.className = `cs-pill ${selectedDiff === DIFFICULTIES.PEACEFUL ? 'is-active' : ''}`;
    peaceBtn.textContent = 'Peaceful';

    normBtn.addEventListener('click', () => {
      this._playClick();
      selectedDiff = DIFFICULTIES.NORMAL;
      normBtn.classList.add('is-active');
      peaceBtn.classList.remove('is-active');
    });
    peaceBtn.addEventListener('click', () => {
      this._playClick();
      selectedDiff = DIFFICULTIES.PEACEFUL;
      peaceBtn.classList.add('is-active');
      normBtn.classList.remove('is-active');
    });
    diffSeg.append(normBtn, peaceBtn);
    diffGroup.append(diffLabel, diffSeg);

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'cs-btn cs-btn--primary';
    playBtn.style.width = '100%';
    playBtn.style.marginTop = '6px';
    playBtn.textContent = 'Play World';
    playBtn.addEventListener('click', () => {
      this._playClick();
      const payload = {
        name: nameInput.value.trim() || 'Emerald Valley',
        seed: seedInput.value.trim(),
        gameMode: selectedMode,
        difficulty: selectedDiff,
      };
      const starter = this.handlers.onPlayNewWorld ?? this.handlers.onStartWorld;
      starter?.(payload);
    });

    left.append(brand, nameGroup, seedGroup, modeGroup, diffGroup, playBtn);

    // Right Column: Saved Worlds + Controls Reference
    const right = document.createElement('div');
    right.className = 'cs-worlds-panel';

    const worldsHeading = document.createElement('h2');
    worldsHeading.className = 'cs-section-heading';
    worldsHeading.textContent = `SAVED WORLDS (${worlds.length})`;

    const worldList = document.createElement('div');
    worldList.className = 'cs-bevel-inset cs-world-list';

    if (!worlds.length) {
      const empty = document.createElement('div');
      empty.className = 'cs-world-empty';
      empty.textContent = 'No saved worlds yet. Launch a new world to auto-save in browser storage.';
      worldList.appendChild(empty);
    } else {
      for (const w of worlds) {
        const row = document.createElement('div');
        row.className = 'cs-world-item';

        const meta = document.createElement('div');
        meta.className = 'cs-world-meta';
        const wName = document.createElement('div');
        wName.className = 'cs-world-name';
        wName.textContent = w.name || 'Untitled World';
        const wSub = document.createElement('div');
        wSub.className = 'cs-world-sub';
        wSub.textContent = `${w.gameMode ?? 'survival'} · Seed ${w.seed ?? 0} · ${formatTimestamp(w.updatedAt)}`;
        meta.append(wName, wSub);

        const actions = document.createElement('div');
        actions.className = 'cs-world-actions';

        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'cs-btn cs-btn--primary cs-btn--sm';
        loadBtn.textContent = 'Load';
        loadBtn.addEventListener('click', () => {
          this._playClick();
          this.handlers.onLoadWorld?.(w.id);
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'cs-btn cs-btn--danger cs-btn--sm';
        delBtn.textContent = this._pendingDeleteId === w.id ? 'Confirm' : 'Delete';
        delBtn.addEventListener('click', () => {
          this._playClick();
          if (this._pendingDeleteId === w.id) {
            this._pendingDeleteId = null;
            this.handlers.onDeleteWorld?.(w.id);
          } else {
            for (const btn of worldList.querySelectorAll('[data-delete-btn="true"]')) {
              btn.textContent = 'Delete';
            }
            this._pendingDeleteId = w.id;
            delBtn.textContent = 'Confirm';
          }
        });
        delBtn.dataset.deleteBtn = 'true';

        actions.append(loadBtn, delBtn);
        row.append(meta, actions);
        worldList.appendChild(row);
      }
    }

    const controlsHeading = document.createElement('h2');
    controlsHeading.className = 'cs-section-heading';
    controlsHeading.textContent = 'QUICK CONTROLS';

    const controlsCard = document.createElement('div');
    controlsCard.className = 'cs-bevel-inset cs-controls-card';
    const pairs = [
      ['Move', 'WASD'],
      ['Jump / Fly', 'Space'],
      ['Sprint / Sneak', 'R or 2×W / Shift'],
      ['Mine / Place', 'LMB / RMB'],
      ['Inventory', 'E'],
      ['Commands', 'T or /'],
      ['Debug Overlay', 'F3'],
      ['Pause Menu', 'Esc'],
    ];
    for (const [label, key] of pairs) {
      const cRow = document.createElement('div');
      cRow.className = 'cs-control-row';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      const kbd = document.createElement('kbd');
      kbd.className = 'cs-kbd';
      kbd.textContent = key;
      cRow.append(lbl, kbd);
      controlsCard.appendChild(cRow);
    }

    right.append(worldsHeading, worldList, controlsHeading, controlsCard);
    shell.append(left, right);
    overlay.appendChild(shell);
    this.container.replaceChildren(overlay);
  }

  showPause(settings = {}) {
    this.close();
    this._activeScreen = 'pause';

    const state = {
      gameMode: settings.gameMode ?? GAME_MODES.SURVIVAL,
      difficulty: settings.difficulty ?? DIFFICULTIES.NORMAL,
      renderDistance: settings.renderDistance ?? 5,
      fov: settings.fov ?? 75,
      sensitivity: settings.sensitivity ?? 1.0,
      volume: settings.volume ?? 0.6,
    };

    const overlay = document.createElement('div');
    overlay.className = 'cs-overlay cs-overlay--dim';

    const card = document.createElement('section');
    card.className = 'cs-panel cs-pause-card';

    const header = document.createElement('div');
    header.className = 'cs-pause-header';
    const title = document.createElement('h2');
    title.className = 'cs-pause-title';
    title.textContent = 'GAME PAUSED';
    header.appendChild(title);

    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'cs-btn cs-btn--primary';
    resumeBtn.textContent = 'Resume Game';
    resumeBtn.addEventListener('click', () => {
      this._playClick();
      this.handlers.onResume?.();
    });

    // Game Mode pills
    const modeGroup = document.createElement('div');
    modeGroup.className = 'cs-form-group';
    const modeLbl = document.createElement('span');
    modeLbl.className = 'cs-label';
    modeLbl.textContent = 'Game Mode';
    const modeSeg = document.createElement('div');
    modeSeg.className = 'cs-segmented';
    const survBtn = document.createElement('button');
    survBtn.type = 'button';
    survBtn.className = `cs-pill ${state.gameMode === GAME_MODES.SURVIVAL ? 'is-active' : ''}`;
    survBtn.textContent = 'Survival';
    const creaBtn = document.createElement('button');
    creaBtn.type = 'button';
    creaBtn.className = `cs-pill cs-pill--gold ${state.gameMode === GAME_MODES.CREATIVE ? 'is-active' : ''}`;
    creaBtn.textContent = 'Creative';

    survBtn.addEventListener('click', () => {
      this._playClick();
      state.gameMode = GAME_MODES.SURVIVAL;
      survBtn.classList.add('is-active');
      creaBtn.classList.remove('is-active');
      this.handlers.onUpdateSettings?.({ gameMode: state.gameMode });
    });
    creaBtn.addEventListener('click', () => {
      this._playClick();
      state.gameMode = GAME_MODES.CREATIVE;
      creaBtn.classList.add('is-active');
      survBtn.classList.remove('is-active');
      this.handlers.onUpdateSettings?.({ gameMode: state.gameMode });
    });
    modeSeg.append(survBtn, creaBtn);
    modeGroup.append(modeLbl, modeSeg);

    // Difficulty pills
    const diffGroup = document.createElement('div');
    diffGroup.className = 'cs-form-group';
    const diffLbl = document.createElement('span');
    diffLbl.className = 'cs-label';
    diffLbl.textContent = 'Difficulty';
    const diffSeg = document.createElement('div');
    diffSeg.className = 'cs-segmented';
    const normBtn = document.createElement('button');
    normBtn.type = 'button';
    normBtn.className = `cs-pill ${state.difficulty === DIFFICULTIES.NORMAL ? 'is-active' : ''}`;
    normBtn.textContent = 'Normal';
    const peaceBtn = document.createElement('button');
    peaceBtn.type = 'button';
    peaceBtn.className = `cs-pill ${state.difficulty === DIFFICULTIES.PEACEFUL ? 'is-active' : ''}`;
    peaceBtn.textContent = 'Peaceful';

    normBtn.addEventListener('click', () => {
      this._playClick();
      state.difficulty = DIFFICULTIES.NORMAL;
      normBtn.classList.add('is-active');
      peaceBtn.classList.remove('is-active');
      this.handlers.onUpdateSettings?.({ difficulty: state.difficulty });
    });
    peaceBtn.addEventListener('click', () => {
      this._playClick();
      state.difficulty = DIFFICULTIES.PEACEFUL;
      peaceBtn.classList.add('is-active');
      normBtn.classList.remove('is-active');
      this.handlers.onUpdateSettings?.({ difficulty: state.difficulty });
    });
    diffSeg.append(normBtn, peaceBtn);
    diffGroup.append(diffLbl, diffSeg);

    const makeSlider = (labelText, min, max, step, initialVal, fmt, onChange) => {
      const group = document.createElement('div');
      group.className = 'cs-form-group';
      const lbl = document.createElement('label');
      lbl.className = 'cs-label';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = labelText;
      const valSpan = document.createElement('span');
      valSpan.className = 'cs-mono';
      valSpan.textContent = fmt(initialVal);
      lbl.append(nameSpan, valSpan);

      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'cs-range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(initialVal);
      input.addEventListener('input', () => {
        const val = Number(input.value);
        valSpan.textContent = fmt(val);
        onChange(val);
      });
      group.append(lbl, input);
      return group;
    };

    const rdSlider = makeSlider(
      'Render Distance',
      3,
      9,
      1,
      state.renderDistance,
      (v) => `${v} chunks`,
      (v) => this.handlers.onUpdateSettings?.({ renderDistance: v }),
    );
    const fovSlider = makeSlider(
      'Field of View',
      60,
      100,
      2,
      state.fov,
      (v) => `${v}°`,
      (v) => this.handlers.onUpdateSettings?.({ fov: v }),
    );
    const sensSlider = makeSlider(
      'Mouse Sensitivity',
      0.2,
      2.5,
      0.1,
      state.sensitivity,
      (v) => `${v.toFixed(1)}×`,
      (v) => this.handlers.onUpdateSettings?.({ sensitivity: v }),
    );
    const volSlider = makeSlider(
      'Audio Volume',
      0,
      1,
      0.05,
      state.volume,
      (v) => `${Math.round(v * 100)}%`,
      (v) => this.handlers.onUpdateSettings?.({ volume: v }),
    );

    const actions = document.createElement('div');
    actions.className = 'cs-pause-actions';
    const exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.className = 'cs-btn cs-btn--gold';
    exitBtn.textContent = 'Save & Exit to Title';
    exitBtn.addEventListener('click', () => {
      this._playClick();
      const exitFn = this.handlers.onSaveAndExit ?? this.handlers.onExitToTitle;
      exitFn?.();
    });
    actions.append(resumeBtn, exitBtn);

    card.append(header, modeGroup, diffGroup, rdSlider, fovSlider, sensSlider, volSlider, actions);
    overlay.appendChild(card);
    this.container.replaceChildren(overlay);
  }

  openContainer({ mode = 'inventory', inventory, blockKey = null, gameMode = GAME_MODES.SURVIVAL }) {
    this.close();
    this._activeScreen = 'container';
    this._containerState = { mode, inventory, blockKey, gameMode };
    this._cursorStack = null;
    this._activeTab = mode === 'creative' ? 'creative' : 'craft';
    const gridSize = mode === 'crafting' ? 3 : 2;
    this._craftGrid = new Array(gridSize * gridSize).fill(null);

    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this._onPointerMove);
    }

    this._renderContainerShell();
    this.refresh();
  }

  _renderContainerShell() {
    const { mode, inventory, blockKey, gameMode } = this._containerState;
    this._slotBindings = [];
    this._recipeCards = [];
    this._furnaceRefs = null;
    this._craftOutputEl = null;

    const overlay = document.createElement('div');
    overlay.className = 'cs-overlay cs-overlay--dim';
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());

    const modal = document.createElement('section');
    modal.className = 'cs-panel cs-container-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'cs-modal-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'cs-modal-title-wrap';
    const title = document.createElement('h2');
    title.className = 'cs-modal-title';
    const titles = {
      inventory: 'INVENTORY & POCKET CRAFTING',
      crafting: 'CRAFTING TABLE (3×3)',
      furnace: 'STONE FURNACE',
      chest: 'STORAGE CHEST',
      creative: this._activeTab === 'craft' ? 'POCKET CRAFTING & BACKPACK' : 'CREATIVE CATALOG',
    };
    title.textContent = titles[mode] ?? 'INVENTORY';
    titleWrap.appendChild(title);

    if (gameMode === GAME_MODES.CREATIVE && (mode === 'inventory' || mode === 'creative')) {
      const tabs = document.createElement('div');
      tabs.className = 'cs-tabs';
      const craftTab = document.createElement('button');
      craftTab.type = 'button';
      craftTab.className = `cs-pill ${this._activeTab === 'craft' ? 'is-active' : ''}`;
      craftTab.textContent = 'Crafting';
      craftTab.addEventListener('click', () => {
        this._playClick();
        this._activeTab = 'craft';
        this._renderContainerShell();
        this.refresh();
      });

      const creaTab = document.createElement('button');
      creaTab.type = 'button';
      creaTab.className = `cs-pill cs-pill--gold ${this._activeTab === 'creative' ? 'is-active' : ''}`;
      creaTab.textContent = 'Creative Catalog';
      creaTab.addEventListener('click', () => {
        this._playClick();
        this._activeTab = 'creative';
        this._renderContainerShell();
        this.refresh();
      });
      tabs.append(craftTab, creaTab);
      titleWrap.appendChild(tabs);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cs-btn cs-btn--sm';
    closeBtn.textContent = 'Close [E]';
    closeBtn.addEventListener('click', () => {
      this._playClick();
      this.close();
    });

    header.append(titleWrap, closeBtn);
    modal.appendChild(header);

    // Body
    const showAssistant =
      (mode === 'inventory' || mode === 'crafting' || mode === 'creative') &&
      this._activeTab === 'craft';
    const showCreative = this._activeTab === 'creative';

    const body = document.createElement('div');
    body.className = `cs-modal-body ${!showAssistant && !showCreative ? 'cs-modal-body--single' : ''}`;

    // Left column: Station + Player Inventory + Hotbar
    const invCol = document.createElement('div');
    invCol.className = 'cs-inv-column';

    if (mode === 'chest') {
      const chestLabel = document.createElement('div');
      chestLabel.className = 'cs-grid-label';
      chestLabel.textContent = 'Chest Storage';
      const chestGrid = document.createElement('div');
      chestGrid.className = 'cs-grid-9';
      const chestSlots = inventory.getOrCreateChest(blockKey ?? 'default');
      for (let i = 0; i < chestSlots.length; i += 1) {
        const el = this._makeInteractiveSlot(() => chestSlots[i], (val) => {
          chestSlots[i] = val;
        }, { kind: 'chest', index: i });
        chestGrid.appendChild(el);
      }
      invCol.append(chestLabel, chestGrid);
    } else if (mode === 'furnace') {
      const furnace = inventory.getOrCreateFurnace(blockKey ?? 'default');
      const station = document.createElement('div');
      station.className = 'cs-bevel-inset cs-station-box';
      const wrap = document.createElement('div');
      wrap.className = 'cs-furnace-station';

      const leftStack = document.createElement('div');
      leftStack.className = 'cs-furnace-left';
      const inLabel = document.createElement('div');
      inLabel.className = 'cs-grid-label';
      inLabel.textContent = 'Ore / Input';
      const inputSlot = this._makeInteractiveSlot(() => furnace.input, (val) => {
        furnace.input = val;
      }, { kind: 'furnace-input' });

      const flameMeter = document.createElement('div');
      flameMeter.className = 'cs-flame-meter';
      const flameFill = document.createElement('div');
      flameFill.className = 'cs-flame-fill';
      flameMeter.appendChild(flameFill);

      const fuelSlot = this._makeInteractiveSlot(() => furnace.fuel, (val) => {
        furnace.fuel = val;
      }, { kind: 'furnace-fuel' });
      const fuelLabel = document.createElement('div');
      fuelLabel.className = 'cs-grid-label';
      fuelLabel.textContent = 'Fuel';

      leftStack.append(inLabel, inputSlot, flameMeter, fuelSlot, fuelLabel);

      const midArrow = document.createElement('div');
      midArrow.className = 'cs-craft-arrow';
      const cookMeter = document.createElement('div');
      cookMeter.className = 'cs-cook-meter';
      const cookFill = document.createElement('div');
      cookFill.className = 'cs-cook-fill';
      cookMeter.appendChild(cookFill);
      const arrowGlyph = document.createElement('span');
      arrowGlyph.textContent = 'SMELT →';
      arrowGlyph.style.fontSize = '11px';
      midArrow.append(arrowGlyph, cookMeter);

      const outWrap = document.createElement('div');
      outWrap.className = 'cs-furnace-left';
      const outLabel = document.createElement('div');
      outLabel.className = 'cs-grid-label';
      outLabel.textContent = 'Output';
      const outSlot = this._makeOutputSlot(() => furnace.output, (event) => {
        this._handleFurnaceOutputClick(furnace, event);
      });
      outWrap.append(outLabel, outSlot);

      wrap.append(leftStack, midArrow, outWrap);
      station.appendChild(wrap);
      invCol.appendChild(station);

      this._furnaceRefs = { furnace, flameFill, cookFill };
    } else if (this._activeTab === 'craft') {
      const gridSize = mode === 'crafting' ? 3 : 2;
      const station = document.createElement('div');
      station.className = 'cs-bevel-inset cs-station-box';

      const craftGridEl = document.createElement('div');
      craftGridEl.className = gridSize === 3 ? 'cs-craft-grid-3' : 'cs-craft-grid-2';
      for (let i = 0; i < gridSize * gridSize; i += 1) {
        const el = this._makeInteractiveSlot(() => this._craftGrid[i], (val) => {
          this._craftGrid[i] = val;
        }, { kind: 'craft', index: i });
        craftGridEl.appendChild(el);
      }

      const arrow = document.createElement('div');
      arrow.className = 'cs-craft-arrow';
      arrow.textContent = '→';

      const outputSlot = this._makeOutputSlot(
        () => matchCraftingRecipe(this._craftGrid, gridSize)?.result ?? null,
        (event) => this._handleCraftOutputClick(gridSize, event),
      );
      this._craftOutputEl = outputSlot;

      station.append(craftGridEl, arrow, outputSlot);
      invCol.appendChild(station);
    }

    // Player Main Inventory (9..35)
    const mainLabel = document.createElement('div');
    mainLabel.className = 'cs-grid-label';
    mainLabel.textContent = 'Backpack';
    const mainGrid = document.createElement('div');
    mainGrid.className = 'cs-grid-9';
    for (let i = 9; i < 36; i += 1) {
      const el = this._makeInteractiveSlot(() => inventory.slots[i], (val) => {
        inventory.slots[i] = val;
      }, { kind: 'player', index: i });
      mainGrid.appendChild(el);
    }

    const divider = document.createElement('div');
    divider.className = 'cs-inv-divider';

    const hotbarLabel = document.createElement('div');
    hotbarLabel.className = 'cs-grid-label';
    hotbarLabel.textContent = 'Hotbar';
    const hotbarGrid = document.createElement('div');
    hotbarGrid.className = 'cs-grid-9';
    for (let i = 0; i < 9; i += 1) {
      const el = this._makeInteractiveSlot(() => inventory.slots[i], (val) => {
        inventory.slots[i] = val;
      }, { kind: 'player', index: i });
      const num = document.createElement('span');
      num.className = 'cs-slot-num';
      num.textContent = String(i + 1);
      el.appendChild(num);
      hotbarGrid.appendChild(el);
    }

    invCol.append(mainLabel, mainGrid, divider, hotbarLabel, hotbarGrid);
    body.appendChild(invCol);

    if (showAssistant) {
      body.appendChild(this._buildRecipeBookPanel(mode === 'crafting' ? 3 : 2));
    } else if (showCreative) {
      body.appendChild(this._buildCreativePanel());
    }

    modal.appendChild(body);
    overlay.append(modal, this.cursorEl, this.tooltipEl);
    this.container.replaceChildren(overlay);
  }

  _buildRecipeBookPanel(gridSize) {
    const panel = document.createElement('aside');
    panel.className = 'cs-bevel-inset cs-assistant-panel';

    const heading = document.createElement('div');
    heading.className = 'cs-section-heading';
    heading.textContent = 'RECIPE BOOK';

    const toolbar = document.createElement('div');
    toolbar.className = 'cs-assistant-toolbar';

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'cs-input';
    search.style.padding = '6px 9px';
    search.style.fontSize = '12px';
    search.placeholder = 'Search recipes...';
    search.value = this._recipeSearch;

    const filterBtn = document.createElement('button');
    filterBtn.type = 'button';
    filterBtn.className = `cs-pill ${this._recipeFilterCraftable ? 'is-active' : ''}`;
    filterBtn.style.whiteSpace = 'nowrap';
    filterBtn.textContent = 'Craftable';

    toolbar.append(search, filterBtn);

    const listEl = document.createElement('div');
    listEl.className = 'cs-recipe-list';

    const renderRecipeRows = () => {
      this._recipeCards = [];
      listEl.replaceChildren();
      const query = this._recipeSearch.trim().toLowerCase();
      const { inventory } = this._containerState;

      for (const recipe of RECIPES) {
        if (query && !recipe.name.toLowerCase().includes(query)) continue;
        const fitsGrid = recipe.minGridSize <= gridSize;
        const hasMaterials = fitsGrid && canPullRecipeFromInventory(recipe, inventory, this._craftGrid);
        if (this._recipeFilterCraftable && !hasMaterials) continue;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = `cs-recipe-card ${hasMaterials ? 'is-craftable' : 'is-locked'}`;

        const iconBox = document.createElement('div');
        iconBox.className = 'cs-recipe-icon-box';
        mountItemVisual(iconBox, recipe.output.id, this.renderIcon, 28);

        const info = document.createElement('div');
        info.className = 'cs-recipe-info';
        const nameRow = document.createElement('div');
        nameRow.className = 'cs-recipe-name';
        const nameTxt = document.createElement('span');
        nameTxt.textContent = recipe.output.count > 1 ? `${recipe.name} ×${recipe.output.count}` : recipe.name;
        const badge = document.createElement('span');
        badge.className = 'cs-recipe-tag';
        badge.textContent = recipe.minGridSize === 3 ? '3×3' : '2×2';
        nameRow.append(nameTxt, badge);

        const ingTxt = document.createElement('div');
        ingTxt.className = 'cs-recipe-ingredients';
        ingTxt.textContent = describeRecipeIngredients(recipe);

        info.append(nameRow, ingTxt);
        card.append(iconBox, info);

        card.addEventListener('click', (event) => {
          this._playClick();
          this._applyRecipeToGrid(recipe, gridSize, event.shiftKey);
        });

        listEl.appendChild(card);
        this._recipeCards.push({ card, recipe, gridSize });
      }

      if (this._recipeCards.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cs-world-empty';
        empty.textContent = 'No matching recipes found.';
        listEl.appendChild(empty);
      }
    };

    search.addEventListener('input', () => {
      this._recipeSearch = search.value;
      renderRecipeRows();
    });
    filterBtn.addEventListener('click', () => {
      this._playClick();
      this._recipeFilterCraftable = !this._recipeFilterCraftable;
      filterBtn.classList.toggle('is-active', this._recipeFilterCraftable);
      renderRecipeRows();
    });

    renderRecipeRows();
    panel.append(heading, toolbar, listEl);
    return panel;
  }

  _buildCreativePanel() {
    const panel = document.createElement('aside');
    panel.className = 'cs-bevel-inset cs-creative-panel';
    panel.style.padding = '10px';

    const headerRow = document.createElement('div');
    headerRow.className = 'cs-section-heading';
    headerRow.textContent = 'CREATIVE ITEMS';
    const trashBtn = document.createElement('button');
    trashBtn.type = 'button';
    trashBtn.className = 'cs-btn cs-btn--danger cs-btn--sm';
    trashBtn.textContent = 'Drop Cursor / Clear';
    trashBtn.addEventListener('click', () => {
      this._playClick();
      if (this._cursorStack) {
        this._cursorStack = null;
      } else {
        this._containerState.inventory.clear();
      }
      this._notifyInventoryChanged();
      this.refresh();
    });
    headerRow.appendChild(trashBtn);

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'cs-input';
    search.style.padding = '6px 9px';
    search.style.fontSize = '12px';
    search.placeholder = 'Filter blocks, tools, food...';
    search.value = this._creativeSearch;

    const filters = document.createElement('div');
    filters.className = 'cs-creative-filters';
    const cats = [
      ['all', 'All'],
      ['block', 'Blocks'],
      ['tool', 'Tools'],
      ['material', 'Materials'],
      ['food', 'Food'],
    ];
    for (const [id, label] of cats) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cs-pill ${this._creativeCategory === id ? 'is-active' : ''}`;
      btn.style.padding = '4px 8px';
      btn.style.fontSize = '11px';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        this._playClick();
        this._creativeCategory = id;
        for (const child of filters.children) {
          child.classList.remove('is-active');
        }
        btn.classList.add('is-active');
        renderCatalog();
      });
      filters.appendChild(btn);
    }

    const grid = document.createElement('div');
    grid.className = 'cs-creative-grid';

    const renderCatalog = () => {
      grid.replaceChildren();
      const q = this._creativeSearch.trim().toLowerCase();
      for (const item of CREATIVE_ITEMS) {
        if (this._creativeCategory !== 'all' && item.category !== this._creativeCategory) continue;
        if (q && !item.name.toLowerCase().includes(q)) continue;

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cs-slot cs-slot--interactive';
        patchSlotElement(cell, { id: item.id, count: 1 }, this.renderIcon, 34);

        cell.addEventListener('pointerenter', () => {
          this._showTooltip({ id: item.id, count: item.stackSize });
        });
        cell.addEventListener('pointerleave', () => this._hideTooltip());
        cell.addEventListener('click', (event) => {
          this._playClick();
          const { inventory } = this._containerState;
          if (event.shiftKey) {
            inventory.addItem(item.id, item.stackSize);
            this._notifyInventoryChanged();
          } else {
            this._cursorStack = {
              id: item.id,
              count: item.stackSize,
              ...(item.maxDurability > 0 ? { durability: item.maxDurability } : {}),
            };
          }
          this.refresh();
        });

        grid.appendChild(cell);
      }
    };

    search.addEventListener('input', () => {
      this._creativeSearch = search.value;
      renderCatalog();
    });

    renderCatalog();
    panel.append(headerRow, search, filters, grid);
    return panel;
  }

  _applyRecipeToGrid(recipe, gridSize, craftImmediately = false) {
    const { inventory } = this._containerState;
    if (recipe.minGridSize > gridSize) return;

    // Return existing craft grid items first so ingredients are pooled cleanly
    for (let i = 0; i < this._craftGrid.length; i += 1) {
      const slot = this._craftGrid[i];
      if (slot && slot.count > 0) {
        inventory.addItem(slot.id, slot.count, slot.durability ?? null);
      }
      this._craftGrid[i] = null;
    }

    if (!canPullRecipeFromInventory(recipe, inventory, this._craftGrid)) {
      this._notifyInventoryChanged();
      this.refresh();
      return;
    }

    if (recipe.type === 'shaped') {
      for (let r = 0; r < recipe.height; r += 1) {
        for (let c = 0; c < recipe.width; c += 1) {
          const expected = recipe.rows[r][c];
          if (expected != null) {
            const pulled = pullOneIngredientFromInventory(expected, inventory);
            this._craftGrid[r * gridSize + c] = pulled;
          }
        }
      }
    } else {
      for (let i = 0; i < recipe.ingredients.length; i += 1) {
        const pulled = pullOneIngredientFromInventory(recipe.ingredients[i], inventory);
        this._craftGrid[i] = pulled;
      }
    }

    if (craftImmediately) {
      const match = matchCraftingRecipe(this._craftGrid, gridSize);
      if (match && canFitInInventory(inventory, match.result.id, match.result.count)) {
        for (const idx of match.consumeIndices) {
          const s = this._craftGrid[idx];
          if (s) {
            s.count -= 1;
            if (s.count <= 0) this._craftGrid[idx] = null;
          }
        }
        inventory.addItem(match.result.id, match.result.count);
      }
    }

    this._notifyInventoryChanged();
    this.refresh();
  }

  _makeInteractiveSlot(getter, setter, meta) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cs-slot cs-slot--interactive';

    btn.addEventListener('pointerenter', () => this._showTooltip(getter()));
    btn.addEventListener('pointerleave', () => this._hideTooltip());
    btn.addEventListener('mousedown', (event) => {
      if (event.button === 0) {
        event.preventDefault();
        this._handleSlotLeftClick(getter, setter, meta, event.shiftKey);
      } else if (event.button === 2) {
        event.preventDefault();
        this._handleSlotRightClick(getter, setter);
      }
    });

    this._slotBindings.push({ el: btn, getter });
    return btn;
  }

  _makeOutputSlot(getter, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cs-slot cs-slot--interactive cs-slot--output';

    btn.addEventListener('pointerenter', () => this._showTooltip(getter()));
    btn.addEventListener('pointerleave', () => this._hideTooltip());
    btn.addEventListener('mousedown', (event) => {
      if (event.button === 0 || event.button === 2) {
        event.preventDefault();
        onClick(event);
      }
    });

    this._slotBindings.push({ el: btn, getter });
    return btn;
  }

  _handleSlotLeftClick(getter, setter, meta, shiftKey) {
    const current = getter();
    const { inventory, mode, blockKey } = this._containerState;

    if (shiftKey && current && current.count > 0) {
      this._playClick();
      if (meta.kind === 'chest' && blockKey != null) {
        const added = inventory.addItem(current.id, current.count, current.durability ?? null);
        if (added > 0) {
          current.count -= added;
          if (current.count <= 0) setter(null);
        }
      } else if (mode === 'chest' && meta.kind === 'player') {
        const chest = inventory.getOrCreateChest(blockKey ?? 'default');
        const moved = this._moveIntoArray(current, chest);
        if (moved >= current.count) setter(null);
        else current.count -= moved;
      } else if (mode === 'furnace' && meta.kind === 'player') {
        const furnace = inventory.getOrCreateFurnace(blockKey ?? 'default');
        if (getSmeltResult(current.id) != null && (!furnace.input || furnace.input.id === current.id)) {
          const moved = this._mergeIntoSlot(current, () => furnace.input, (v) => {
            furnace.input = v;
          });
          if (moved >= current.count) setter(null);
          else current.count -= moved;
        } else if (getFuelBurnTime(current.id) > 0 && (!furnace.fuel || furnace.fuel.id === current.id)) {
          const moved = this._mergeIntoSlot(current, () => furnace.fuel, (v) => {
            furnace.fuel = v;
          });
          if (moved >= current.count) setter(null);
          else current.count -= moved;
        }
      } else if (meta.kind === 'furnace-input' || meta.kind === 'furnace-fuel' || meta.kind === 'craft') {
        const added = inventory.addItem(current.id, current.count, current.durability ?? null);
        if (added > 0) {
          current.count -= added;
          if (current.count <= 0) setter(null);
        }
      } else if (meta.kind === 'player') {
        const targetRange = meta.index < 9 ? [9, 36] : [0, 9];
        const moved = this._moveIntoRange(current, inventory.slots, targetRange[0], targetRange[1]);
        if (moved >= current.count) setter(null);
        else current.count -= moved;
      }
      this._notifyInventoryChanged();
      this.refresh();
      return;
    }

    this._playClick();
    if (!this._cursorStack && current) {
      this._cursorStack = current;
      setter(null);
    } else if (this._cursorStack && !current) {
      setter(this._cursorStack);
      this._cursorStack = null;
    } else if (this._cursorStack && current) {
      const def = getItemDef(current.id);
      const maxStack = def?.stackSize ?? 64;
      if (
        current.id === this._cursorStack.id &&
        maxStack > 1 &&
        current.durability == null &&
        this._cursorStack.durability == null
      ) {
        const room = maxStack - current.count;
        const move = Math.min(room, this._cursorStack.count);
        current.count += move;
        this._cursorStack.count -= move;
        if (this._cursorStack.count <= 0) {
          this._cursorStack = null;
        }
      } else {
        setter(this._cursorStack);
        this._cursorStack = current;
      }
    }

    this._notifyInventoryChanged();
    this.refresh();
  }

  _handleSlotRightClick(getter, setter) {
    const current = getter();
    this._playClick();

    if (!this._cursorStack && current) {
      const half = Math.ceil(current.count / 2);
      this._cursorStack = { ...current, count: half };
      current.count -= half;
      if (current.count <= 0) setter(null);
    } else if (this._cursorStack && !current) {
      setter({ ...this._cursorStack, count: 1 });
      this._cursorStack.count -= 1;
      if (this._cursorStack.count <= 0) this._cursorStack = null;
    } else if (this._cursorStack && current) {
      const def = getItemDef(current.id);
      const maxStack = def?.stackSize ?? 64;
      if (
        current.id === this._cursorStack.id &&
        current.count < maxStack &&
        current.durability == null &&
        this._cursorStack.durability == null
      ) {
        current.count += 1;
        this._cursorStack.count -= 1;
        if (this._cursorStack.count <= 0) this._cursorStack = null;
      }
    }

    this._notifyInventoryChanged();
    this.refresh();
  }

  _handleCraftOutputClick(gridSize, event) {
    const { inventory } = this._containerState;
    const firstMatch = matchCraftingRecipe(this._craftGrid, gridSize);
    if (!firstMatch) return;

    this._playClick();
    const outDef = getItemDef(firstMatch.result.id);
    const maxStack = outDef?.stackSize ?? 64;

    if (event.shiftKey) {
      // Craft up to a full stack directly into player inventory without partial-add loss
      let craftedCount = 0;
      const limit = maxStack > 1 ? 64 : 1;
      while (craftedCount < limit) {
        const match = matchCraftingRecipe(this._craftGrid, gridSize);
        if (!match || match.recipe.id !== firstMatch.recipe.id) break;
        if (!canFitInInventory(inventory, match.result.id, match.result.count)) break;
        for (const idx of match.consumeIndices) {
          const slot = this._craftGrid[idx];
          if (slot) {
            slot.count -= 1;
            if (slot.count <= 0) this._craftGrid[idx] = null;
          }
        }
        inventory.addItem(match.result.id, match.result.count);
        craftedCount += match.result.count;
      }
    } else {
      const canMergeCursor =
        !this._cursorStack ||
        (this._cursorStack.id === firstMatch.result.id &&
          maxStack > 1 &&
          this._cursorStack.count + firstMatch.result.count <= maxStack);
      if (!canMergeCursor) return;

      for (const idx of firstMatch.consumeIndices) {
        const slot = this._craftGrid[idx];
        if (slot) {
          slot.count -= 1;
          if (slot.count <= 0) this._craftGrid[idx] = null;
        }
      }

      if (!this._cursorStack) {
        this._cursorStack = {
          id: firstMatch.result.id,
          count: firstMatch.result.count,
          ...(outDef?.maxDurability > 0 ? { durability: outDef.maxDurability } : {}),
        };
      } else {
        this._cursorStack.count += firstMatch.result.count;
      }
    }

    this._notifyInventoryChanged();
    this.refresh();
  }

  _handleFurnaceOutputClick(furnace, event) {
    if (!furnace.output || furnace.output.count <= 0) return;
    this._playClick();
    const { inventory } = this._containerState;

    if (event.shiftKey) {
      const added = inventory.addItem(furnace.output.id, furnace.output.count);
      furnace.output.count -= added;
      if (furnace.output.count <= 0) furnace.output = null;
    } else if (!this._cursorStack) {
      this._cursorStack = furnace.output;
      furnace.output = null;
    } else if (this._cursorStack.id === furnace.output.id) {
      const maxStack = getItemDef(furnace.output.id)?.stackSize ?? 64;
      const move = Math.min(maxStack - this._cursorStack.count, furnace.output.count);
      if (move > 0) {
        this._cursorStack.count += move;
        furnace.output.count -= move;
        if (furnace.output.count <= 0) furnace.output = null;
      }
    }

    this._notifyInventoryChanged();
    this.refresh();
  }

  _moveIntoArray(source, targetArray) {
    return this._moveIntoRange(source, targetArray, 0, targetArray.length);
  }

  _moveIntoRange(source, targetArray, start, end) {
    const def = getItemDef(source.id);
    const maxStack = def?.stackSize ?? 64;
    let remaining = source.count;

    if (maxStack > 1 && source.durability == null) {
      for (let i = start; i < end && remaining > 0; i += 1) {
        const slot = targetArray[i];
        if (slot && slot.id === source.id && slot.count < maxStack) {
          const move = Math.min(maxStack - slot.count, remaining);
          slot.count += move;
          remaining -= move;
        }
      }
    }
    for (let i = start; i < end && remaining > 0; i += 1) {
      if (!targetArray[i]) {
        const move = Math.min(maxStack, remaining);
        targetArray[i] = { ...source, count: move };
        remaining -= move;
      }
    }
    return source.count - remaining;
  }

  _mergeIntoSlot(source, getter, setter) {
    const def = getItemDef(source.id);
    const maxStack = def?.stackSize ?? 64;
    const existing = getter();
    if (!existing) {
      const move = Math.min(maxStack, source.count);
      setter({ ...source, count: move });
      return move;
    }
    if (existing.id === source.id && maxStack > 1) {
      const move = Math.min(maxStack - existing.count, source.count);
      existing.count += move;
      return move;
    }
    return 0;
  }

  _showTooltip(stack) {
    const info = describeStackTooltip(stack);
    if (!info) {
      this._hideTooltip();
      return;
    }
    this.tooltipNameEl.textContent = info.name;
    this.tooltipMetaEl.textContent = info.meta;
    this.tooltipEl.classList.add('is-visible');
  }

  _hideTooltip() {
    this.tooltipEl.classList.remove('is-visible');
  }

  refresh() {
    if (this._activeScreen !== 'container' || !this._containerState) return;

    for (const binding of this._slotBindings) {
      patchSlotElement(binding.el, binding.getter() ?? null, this.renderIcon, 34);
    }

    if (this._cursorStack && this._cursorStack.count > 0) {
      this.cursorEl.classList.add('is-visible');
      patchSlotElement(this.cursorEl, this._cursorStack, this.renderIcon, 36);
    } else {
      this.cursorEl.classList.remove('is-visible');
      patchSlotElement(this.cursorEl, null, this.renderIcon, 36);
    }

    if (this._furnaceRefs) {
      const { furnace, flameFill, cookFill } = this._furnaceRefs;
      const burnPct = furnace.maxBurnTime > 0 ? Math.min(100, (furnace.burnTime / furnace.maxBurnTime) * 100) : 0;
      const cookPct = Math.min(100, (furnace.cookProgress / FURNACE_COOK_TIME) * 100);
      flameFill.style.height = `${burnPct.toFixed(1)}%`;
      cookFill.style.width = `${cookPct.toFixed(1)}%`;
    }

    if (this._recipeCards.length > 0) {
      const { inventory } = this._containerState;
      for (const entry of this._recipeCards) {
        const fits = entry.recipe.minGridSize <= entry.gridSize;
        const ok = fits && canPullRecipeFromInventory(entry.recipe, inventory, this._craftGrid);
        entry.card.classList.toggle('is-craftable', ok);
        entry.card.classList.toggle('is-locked', !ok);
      }
    }
  }

  destroy() {
    this.close();
  }
}
