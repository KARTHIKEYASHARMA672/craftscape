import { GAME_MODES, PLAYER_CONSTANTS } from '../core/constants.js';
import { getItemDef } from '../core/items.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function createFallbackItemSvg(def) {
  const svg = createSvgEl('svg', {
    viewBox: '0 0 16 16',
    class: 'cs-item-visual',
    'aria-hidden': 'true',
  });
  const baseColor = def.iconColor || def.mapColor || '#9aa3af';

  if (def.toolKind === 'pickaxe') {
    svg.appendChild(createSvgEl('path', { d: 'M3 13 L10 6', stroke: '#8f6237', 'stroke-width': 2, 'stroke-linecap': 'square' }));
    svg.appendChild(createSvgEl('path', { d: 'M4 3 H12 V6 H10 V5 H4 Z M10 6 H13 V11 H11 V6 Z', fill: baseColor, stroke: '#10141a', 'stroke-width': 0.7 }));
  } else if (def.toolKind === 'axe') {
    svg.appendChild(createSvgEl('path', { d: 'M3 13 L11 5', stroke: '#8f6237', 'stroke-width': 2, 'stroke-linecap': 'square' }));
    svg.appendChild(createSvgEl('path', { d: 'M7 2 H13 V8 H10 V6 H7 Z', fill: baseColor, stroke: '#10141a', 'stroke-width': 0.7 }));
  } else if (def.toolKind === 'shovel') {
    svg.appendChild(createSvgEl('path', { d: 'M3 13 L10 6', stroke: '#8f6237', 'stroke-width': 2, 'stroke-linecap': 'square' }));
    svg.appendChild(createSvgEl('path', { d: 'M9 2 H14 V7 L11 7 L9 5 Z', fill: baseColor, stroke: '#10141a', 'stroke-width': 0.7 }));
  } else if (def.toolKind === 'sword') {
    svg.appendChild(createSvgEl('path', { d: 'M3 13 L6 10', stroke: '#7a522d', 'stroke-width': 2 }));
    svg.appendChild(createSvgEl('path', { d: 'M4 8 L8 12', stroke: '#3c4654', 'stroke-width': 2 }));
    svg.appendChild(createSvgEl('path', { d: 'M6 10 L13 3 L13 5 L8 10 Z', fill: baseColor, stroke: '#10141a', 'stroke-width': 0.7 }));
  } else if (def.iconType === 'stick') {
    svg.appendChild(createSvgEl('path', { d: 'M4 12 L12 4', stroke: baseColor, 'stroke-width': 2.5, 'stroke-linecap': 'square' }));
  } else if (def.iconType === 'ingot') {
    svg.appendChild(createSvgEl('rect', { x: 2, y: 5, width: 12, height: 6, rx: 1, fill: baseColor, stroke: '#10141a', 'stroke-width': 1 }));
    svg.appendChild(createSvgEl('rect', { x: 3.5, y: 6, width: 9, height: 2, fill: 'rgba(255,255,255,0.35)' }));
  } else if (def.iconType === 'diamond' || def.iconType === 'gem') {
    svg.appendChild(createSvgEl('polygon', { points: '8,2 14,7 8,14 2,7', fill: baseColor, stroke: '#10141a', 'stroke-width': 1 }));
    svg.appendChild(createSvgEl('polygon', { points: '8,3.5 11.5,7 8,10.5 4.5,7', fill: 'rgba(255,255,255,0.28)' }));
  } else if (def.iconType === 'apple') {
    svg.appendChild(createSvgEl('circle', { cx: 8, cy: 9, r: 5, fill: baseColor, stroke: '#10141a', 'stroke-width': 1 }));
    svg.appendChild(createSvgEl('rect', { x: 7.4, y: 2, width: 1.4, height: 3, fill: '#6b4c2d' }));
  } else if (def.iconType === 'bread' || def.iconType === 'meat') {
    svg.appendChild(createSvgEl('rect', { x: 2.5, y: 4.5, width: 11, height: 7, rx: 3, fill: baseColor, stroke: '#10141a', 'stroke-width': 1 }));
  } else if (def.iconType === 'dust') {
    svg.appendChild(createSvgEl('circle', { cx: 6, cy: 7, r: 2.3, fill: baseColor }));
    svg.appendChild(createSvgEl('circle', { cx: 10.5, cy: 6, r: 2, fill: baseColor }));
    svg.appendChild(createSvgEl('circle', { cx: 8.5, cy: 10.5, r: 2.5, fill: baseColor }));
  } else {
    // Isometric voxel block fallback
    svg.appendChild(createSvgEl('polygon', { points: '8,2 14,5.5 8,9 2,5.5', fill: baseColor, stroke: '#10141a', 'stroke-width': 0.8 }));
    svg.appendChild(createSvgEl('polygon', { points: '2,5.5 8,9 8,14.5 2,11', fill: baseColor, opacity: '0.84', stroke: '#10141a', 'stroke-width': 0.8 }));
    svg.appendChild(createSvgEl('polygon', { points: '14,5.5 8,9 8,14.5 14,11', fill: baseColor, opacity: '0.66', stroke: '#10141a', 'stroke-width': 0.8 }));
  }

  return svg;
}

export function mountItemVisual(container, itemId, renderIcon, size = 34) {
  container.replaceChildren();
  if (itemId == null) return;
  const def = getItemDef(itemId);
  if (!def) return;

  if (typeof renderIcon === 'function') {
    const icon = renderIcon(itemId, size);
    if (typeof Node !== 'undefined' && icon instanceof Node) {
      if (icon.classList) icon.classList.add('cs-item-visual');
      container.appendChild(icon);
      return;
    }
    if (typeof icon === 'string' && icon.length > 0) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = def.name;
      img.draggable = false;
      img.className = 'cs-item-visual';
      container.appendChild(img);
      return;
    }
  }

  container.appendChild(createFallbackItemSvg(def));
}

export function patchSlotElement(slotEl, stack, renderIcon, size = 34) {
  const sig = stack ? `${stack.id}:${stack.count}:${stack.durability ?? ''}` : '';
  if (slotEl.dataset.sig === sig) return;
  slotEl.dataset.sig = sig;

  let visualBox = slotEl.querySelector('.cs-slot-visual');
  if (!visualBox) {
    visualBox = document.createElement('span');
    visualBox.className = 'cs-slot-visual';
    slotEl.appendChild(visualBox);
  }

  let countEl = slotEl.querySelector('.cs-slot-count');
  let durTrack = slotEl.querySelector('.cs-durability-track');

  if (!stack || stack.id == null || stack.count <= 0) {
    visualBox.replaceChildren();
    if (countEl) countEl.remove();
    if (durTrack) durTrack.remove();
    slotEl.removeAttribute('aria-label');
    return;
  }

  const def = getItemDef(stack.id);
  slotEl.setAttribute('aria-label', def ? `${def.name} (${stack.count})` : `Item ${stack.id}`);

  const prevItemId = visualBox.dataset.itemId;
  if (prevItemId !== String(stack.id)) {
    visualBox.dataset.itemId = String(stack.id);
    mountItemVisual(visualBox, stack.id, renderIcon, size);
  }

  if (stack.count > 1) {
    if (!countEl) {
      countEl = document.createElement('span');
      countEl.className = 'cs-slot-count';
      slotEl.appendChild(countEl);
    }
    countEl.textContent = String(stack.count);
  } else if (countEl) {
    countEl.remove();
  }

  if (def && def.maxDurability > 0 && stack.durability != null && stack.durability < def.maxDurability) {
    const ratio = Math.max(0, Math.min(1, stack.durability / def.maxDurability));
    if (!durTrack) {
      durTrack = document.createElement('span');
      durTrack.className = 'cs-durability-track';
      const fill = document.createElement('span');
      fill.className = 'cs-durability-fill';
      durTrack.appendChild(fill);
      slotEl.appendChild(durTrack);
    }
    const fillEl = durTrack.firstElementChild;
    fillEl.style.width = `${Math.round(ratio * 100)}%`;
    fillEl.style.background =
      ratio > 0.5 ? '#2E8B57' : ratio > 0.22 ? '#D9A441' : '#D9463E';
  } else if (durTrack) {
    durTrack.remove();
  }
}

function buildHeartSvg(state) {
  // state: 'full' | 'half' | 'empty'
  const svg = createSvgEl('svg', { viewBox: '0 0 16 16', class: 'cs-vital-svg', 'aria-hidden': 'true' });
  svg.appendChild(
    createSvgEl('path', {
      d: 'M8 14 L2 8.2 C0.8 6.8 0.9 4.4 2.5 3.1 C4 1.9 6.2 2.2 7.5 3.6 L8 4.2 L8.5 3.6 C9.8 2.2 12 1.9 13.5 3.1 C15.1 4.4 15.2 6.8 14 8.2 Z',
      fill: '#141920',
      stroke: '#06080b',
      'stroke-width': 1.2,
    }),
  );
  if (state === 'full') {
    svg.appendChild(
      createSvgEl('path', {
        d: 'M8 13 L2.8 7.8 C1.9 6.8 2 5 3.1 4 C4.2 3.1 5.8 3.4 6.9 4.5 L8 5.7 L9.1 4.5 C10.2 3.4 11.8 3.1 12.9 4 C14 5 14.1 6.8 13.2 7.8 Z',
        fill: '#D9463E',
      }),
    );
    svg.appendChild(createSvgEl('rect', { x: 3.5, y: 4.5, width: 2, height: 1.5, fill: '#ff9b95' }));
  } else if (state === 'half') {
    svg.appendChild(
      createSvgEl('path', {
        d: 'M8 13 L2.8 7.8 C1.9 6.8 2 5 3.1 4 C4.2 3.1 5.8 3.4 6.9 4.5 L8 5.7 Z',
        fill: '#D9463E',
      }),
    );
    svg.appendChild(createSvgEl('rect', { x: 3.5, y: 4.5, width: 2, height: 1.5, fill: '#ff9b95' }));
  }
  return svg;
}

function buildHungerSvg(state) {
  const svg = createSvgEl('svg', { viewBox: '0 0 16 16', class: 'cs-vital-svg', 'aria-hidden': 'true' });
  svg.appendChild(
    createSvgEl('path', {
      d: 'M5 10 C3 10 2 8.2 2 6.2 C2 3.8 4.4 2 7.2 2 C9.4 2 11.2 3.4 11.2 5.4 C11.2 7.4 9.6 9 7.8 9.4 L12.8 12.6 L11.4 14 L6.4 10.2 Z',
      fill: '#141920',
      stroke: '#06080b',
      'stroke-width': 1.1,
    }),
  );
  if (state === 'full') {
    svg.appendChild(
      createSvgEl('path', {
        d: 'M5.2 9.2 C3.6 9.2 2.8 7.8 2.8 6.2 C2.8 4.3 4.8 2.8 7.1 2.8 C8.9 2.8 10.3 3.9 10.3 5.4 C10.3 7 9 8.2 7.3 8.6 L12.2 12.4 L11.3 13.3 L6.2 9.4 Z',
        fill: '#C9833C',
      }),
    );
    svg.appendChild(createSvgEl('circle', { cx: 5.5, cy: 5.2, r: 1.2, fill: '#f0b878' }));
  } else if (state === 'half') {
    svg.appendChild(
      createSvgEl('path', {
        d: 'M5.2 9.2 C3.6 9.2 2.8 7.8 2.8 6.2 C2.8 4.3 4.8 2.8 7.1 2.8 L7.1 8.8 Z',
        fill: '#C9833C',
      }),
    );
  }
  return svg;
}

function buildOxygenSvg(state) {
  const svg = createSvgEl('svg', { viewBox: '0 0 16 16', class: 'cs-vital-svg', 'aria-hidden': 'true' });
  if (state === 'empty') {
    svg.appendChild(
      createSvgEl('circle', {
        cx: 8,
        cy: 8,
        r: 5.2,
        fill: 'none',
        stroke: 'rgba(130, 195, 255, 0.35)',
        'stroke-width': 1.2,
        'stroke-dasharray': '2 2',
      }),
    );
    return svg;
  }
  svg.appendChild(
    createSvgEl('circle', {
      cx: 8,
      cy: 8,
      r: 5.5,
      fill: state === 'half' ? 'rgba(84, 178, 255, 0.35)' : 'rgba(84, 178, 255, 0.78)',
      stroke: '#e3f4ff',
      'stroke-width': 1.2,
    }),
  );
  svg.appendChild(createSvgEl('circle', { cx: 6.2, cy: 6, r: 1.3, fill: '#ffffff' }));
  return svg;
}

function updateVitalIcons(rowEl, value, maxValue, builder, cacheKey) {
  const clamped = Math.max(0, Math.min(maxValue, Math.round(value)));
  if (rowEl.dataset[cacheKey] === String(clamped)) return;
  rowEl.dataset[cacheKey] = String(clamped);

  const count = Math.ceil(maxValue / 2);
  if (rowEl.children.length !== count) {
    rowEl.replaceChildren();
    for (let i = 0; i < count; i += 1) {
      const span = document.createElement('span');
      rowEl.appendChild(span);
    }
  }

  for (let i = 0; i < count; i += 1) {
    const cell = rowEl.children[i];
    const threshold = (i + 1) * 2;
    const state = clamped >= threshold ? 'full' : clamped === threshold - 1 ? 'half' : 'empty';
    if (cell.dataset.state !== state) {
      cell.dataset.state = state;
      cell.replaceChildren(builder(state));
    }
  }
}

export class GameHUD {
  constructor(container, { renderIcon, onCommand } = {}) {
    this.container = container;
    this.renderIcon = renderIcon;
    this.onCommand = onCommand;

    this._debugOpen = false;
    this._commandOpen = false;
    this._visible = true;
    this._lastSelectedHotbar = -1;
    this._lastHeldKey = '';
    this._heldFadeTimer = null;
    this._hurtTimer = null;
    this._commandHistory = [];
    this._historyIndex = -1;
    this._debugRows = {};

    this._buildDom();
  }

  _buildDom() {
    this.root = document.createElement('div');
    this.root.className = 'cs-hud';

    this.underwaterEl = document.createElement('div');
    this.underwaterEl.className = 'cs-underwater-tint';

    this.damageEl = document.createElement('div');
    this.damageEl.className = 'cs-damage-vignette';

    this.crosshairEl = document.createElement('div');
    this.crosshairEl.className = 'cs-crosshair';
    this.crosshairEl.setAttribute('aria-hidden', 'true');

    // F3 Telemetry
    this.debugEl = document.createElement('aside');
    this.debugEl.className = 'cs-debug';
    const debugTitle = document.createElement('div');
    debugTitle.className = 'cs-debug-title';
    debugTitle.textContent = 'CRAFTSCAPE TELEMETRY [F3]';
    this.debugEl.appendChild(debugTitle);

    const fields = ['FPS', 'XYZ', 'Chunk', 'Biome', 'Light', 'Facing', 'Target', 'Mode', 'Seed'];
    for (const label of fields) {
      const row = document.createElement('div');
      row.className = 'cs-debug-row';
      const k = document.createElement('span');
      k.className = 'cs-debug-key';
      k.textContent = label;
      const v = document.createElement('span');
      v.className = 'cs-debug-val';
      v.textContent = '--';
      row.append(k, v);
      this.debugEl.appendChild(row);
      this._debugRows[label] = v;
    }

    // Toast Stack
    this.toastStackEl = document.createElement('div');
    this.toastStackEl.className = 'cs-toasts';

    // Chat / Command Bar
    this.chatWrapEl = document.createElement('div');
    this.chatWrapEl.className = 'cs-chat-wrap';

    this.chatFeedEl = document.createElement('div');
    this.chatFeedEl.className = 'cs-chat-feed';

    this.commandBarEl = document.createElement('form');
    this.commandBarEl.className = 'cs-command-bar';
    const promptSpan = document.createElement('span');
    promptSpan.className = 'cs-command-prompt';
    promptSpan.textContent = '>';

    this.commandInputEl = document.createElement('input');
    this.commandInputEl.type = 'text';
    this.commandInputEl.className = 'cs-command-input';
    this.commandInputEl.placeholder = 'Type /help, /gamemode, /time set, /tp, /give...';
    this.commandInputEl.autocomplete = 'off';
    this.commandInputEl.spellcheck = false;

    this.commandBarEl.append(promptSpan, this.commandInputEl);
    this.chatWrapEl.append(this.chatFeedEl, this.commandBarEl);

    // Bottom Dock (Held tooltip + Vitals + 9-Slot Hotbar)
    this.dockEl = document.createElement('div');
    this.dockEl.className = 'cs-dock';

    this.heldLabelEl = document.createElement('div');
    this.heldLabelEl.className = 'cs-held-label';

    this.vitalsEl = document.createElement('div');
    this.vitalsEl.className = 'cs-vitals';

    const vitalsLeft = document.createElement('div');
    vitalsLeft.className = 'cs-vitals-left';
    this.healthRowEl = document.createElement('div');
    this.healthRowEl.className = 'cs-vital-row';
    vitalsLeft.appendChild(this.healthRowEl);

    const vitalsRight = document.createElement('div');
    vitalsRight.className = 'cs-vitals-right';
    this.oxygenRowEl = document.createElement('div');
    this.oxygenRowEl.className = 'cs-vital-row is-hidden';
    this.hungerRowEl = document.createElement('div');
    this.hungerRowEl.className = 'cs-vital-row';
    vitalsRight.append(this.oxygenRowEl, this.hungerRowEl);

    this.vitalsEl.append(vitalsLeft, vitalsRight);

    this.hotbarEl = document.createElement('div');
    this.hotbarEl.className = 'cs-hotbar';
    this.hotbarSlots = [];
    for (let i = 0; i < 9; i += 1) {
      const slot = document.createElement('div');
      slot.className = 'cs-slot';
      const num = document.createElement('span');
      num.className = 'cs-slot-num';
      num.textContent = String(i + 1);
      slot.appendChild(num);
      this.hotbarEl.appendChild(slot);
      this.hotbarSlots.push(slot);
    }

    this.dockEl.append(this.heldLabelEl, this.vitalsEl, this.hotbarEl);

    this.root.append(
      this.underwaterEl,
      this.damageEl,
      this.crosshairEl,
      this.debugEl,
      this.toastStackEl,
      this.chatWrapEl,
      this.dockEl,
    );

    this.container.replaceChildren(this.root);

    this._onCommandSubmit = (event) => {
      event.preventDefault();
      const raw = this.commandInputEl.value.trim();
      this.closeCommandBar();
      if (!raw) return;

      this._commandHistory.unshift(raw);
      if (this._commandHistory.length > 30) this._commandHistory.pop();
      this._historyIndex = -1;

      if (typeof this.onCommand === 'function') {
        const result = this.onCommand(raw);
        if (result && typeof result.then === 'function') {
          result.then((resolved) => {
            if (resolved && typeof resolved.message === 'string') {
              this.addChatMessage(resolved.message, resolved.ok ? 'ok' : 'error');
            }
          });
        } else if (result && typeof result.message === 'string') {
          this.addChatMessage(result.message, result.ok ? 'ok' : 'error');
        }
      }
    };

    this._onCommandKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeCommandBar();
        return;
      }
      if (event.key === 'ArrowUp') {
        if (this._commandHistory.length > 0) {
          event.preventDefault();
          this._historyIndex = Math.min(this._commandHistory.length - 1, this._historyIndex + 1);
          this.commandInputEl.value = this._commandHistory[this._historyIndex];
        }
      } else if (event.key === 'ArrowDown') {
        if (this._historyIndex >= 0) {
          event.preventDefault();
          this._historyIndex -= 1;
          this.commandInputEl.value = this._historyIndex >= 0 ? this._commandHistory[this._historyIndex] : '';
        }
      }
    };

    this.commandBarEl.addEventListener('submit', this._onCommandSubmit);
    this.commandInputEl.addEventListener('keydown', this._onCommandKeyDown);
  }

  setVisible(visible) {
    this._visible = Boolean(visible);
    this.root.classList.toggle('is-hidden', !this._visible);
  }

  toggleDebug(force) {
    this._debugOpen = typeof force === 'boolean' ? force : !this._debugOpen;
    this.debugEl.classList.toggle('is-open', this._debugOpen);
    return this._debugOpen;
  }

  isDebugOpen() {
    return this._debugOpen;
  }

  openCommandBar(initialText = '') {
    this._commandOpen = true;
    this._historyIndex = -1;
    this.chatWrapEl.classList.add('is-open');
    this.commandInputEl.value = initialText;
    this.commandInputEl.focus();
    const len = this.commandInputEl.value.length;
    this.commandInputEl.setSelectionRange(len, len);
  }

  closeCommandBar() {
    this._commandOpen = false;
    this.chatWrapEl.classList.remove('is-open');
    this.commandInputEl.blur();
  }

  isCommandBarOpen() {
    return this._commandOpen;
  }

  addChatMessage(msg, kind = 'info') {
    if (!msg) return;
    const line = document.createElement('div');
    line.className = `cs-chat-msg cs-chat-msg--${kind}`;
    line.textContent = String(msg);
    this.chatFeedEl.appendChild(line);

    while (this.chatFeedEl.children.length > 6) {
      this.chatFeedEl.firstElementChild.remove();
    }

    setTimeout(() => {
      line.classList.add('is-faded');
    }, 5200);
  }

  showToast(msg, durationMs = 2600) {
    if (!msg) return;
    const toast = document.createElement('div');
    toast.className = 'cs-toast';
    toast.textContent = String(msg);
    this.toastStackEl.appendChild(toast);

    while (this.toastStackEl.children.length > 4) {
      this.toastStackEl.firstElementChild.remove();
    }

    setTimeout(() => {
      toast.remove();
    }, durationMs);
  }

  flashDamage() {
    this.damageEl.classList.add('is-active');
    clearTimeout(this._hurtTimer);
    this._hurtTimer = setTimeout(() => {
      this.damageEl.classList.remove('is-active');
    }, 220);
  }

  updateState(snapshot = {}) {
    const mode = snapshot.gameMode ?? GAME_MODES.SURVIVAL;
    const isSurvival = mode !== GAME_MODES.CREATIVE;
    this.vitalsEl.classList.toggle('is-hidden', !isSurvival);

    const health = snapshot.health ?? PLAYER_CONSTANTS.MAX_HEALTH;
    const hunger = snapshot.hunger ?? PLAYER_CONSTANTS.MAX_HUNGER;
    const oxygen = snapshot.oxygen ?? PLAYER_CONSTANTS.MAX_OXYGEN;
    const submerged = Boolean(snapshot.submerged || snapshot.underwater || oxygen < PLAYER_CONSTANTS.MAX_OXYGEN);

    this.underwaterEl.classList.toggle('is-active', Boolean(snapshot.submerged || snapshot.underwater));
    if (snapshot.hurtFlash) {
      this.flashDamage();
    }

    if (isSurvival) {
      updateVitalIcons(this.healthRowEl, health, PLAYER_CONSTANTS.MAX_HEALTH, buildHeartSvg, 'health');
      updateVitalIcons(this.hungerRowEl, hunger, PLAYER_CONSTANTS.MAX_HUNGER, buildHungerSvg, 'hunger');
      this.oxygenRowEl.classList.toggle('is-hidden', !submerged);
      if (submerged) {
        updateVitalIcons(this.oxygenRowEl, oxygen, PLAYER_CONSTANTS.MAX_OXYGEN, buildOxygenSvg, 'oxygen');
      }
    }

    const slots = snapshot.slots ?? [];
    const selected = Math.max(0, Math.min(8, snapshot.selectedHotbar ?? 0));

    for (let i = 0; i < 9; i += 1) {
      const slotEl = this.hotbarSlots[i];
      slotEl.classList.toggle('cs-slot--selected', i === selected);
      patchSlotElement(slotEl, slots[i] ?? null, this.renderIcon, 34);
    }

    const held = slots[selected] ?? null;
    const heldKey = `${selected}:${held ? held.id : ''}`;
    if (heldKey !== this._lastHeldKey || selected !== this._lastSelectedHotbar) {
      this._lastHeldKey = heldKey;
      this._lastSelectedHotbar = selected;
      const heldDef = held ? getItemDef(held.id) : null;
      clearTimeout(this._heldFadeTimer);
      if (heldDef) {
        this.heldLabelEl.textContent = heldDef.name;
        this.heldLabelEl.classList.add('is-visible');
        this._heldFadeTimer = setTimeout(() => {
          this.heldLabelEl.classList.remove('is-visible');
        }, 2000);
      } else {
        this.heldLabelEl.classList.remove('is-visible');
      }
    }

    if (this._debugOpen) {
      const pos = snapshot.position;
      const chunk = snapshot.chunk;
      this._debugRows.FPS.textContent = snapshot.fps != null ? `${Math.round(snapshot.fps)}` : '--';
      this._debugRows.XYZ.textContent = pos
        ? `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`
        : '--';
      this._debugRows.Chunk.textContent = chunk ? `${chunk.cx}, ${chunk.cz}` : '--';
      this._debugRows.Biome.textContent = snapshot.biome ?? '--';
      if (snapshot.light && typeof snapshot.light === 'object') {
        this._debugRows.Light.textContent = `Sky ${snapshot.light.sky ?? 0} / Block ${snapshot.light.block ?? 0}`;
      } else {
        this._debugRows.Light.textContent = snapshot.light != null ? String(snapshot.light) : '--';
      }
      this._debugRows.Facing.textContent = snapshot.facing ?? '--';
      if (snapshot.targetBlock && typeof snapshot.targetBlock === 'object') {
        const tb = snapshot.targetBlock;
        this._debugRows.Target.textContent = `${tb.name ?? 'Block'} (${tb.x}, ${tb.y}, ${tb.z})`;
      } else {
        this._debugRows.Target.textContent = snapshot.targetBlock ?? 'None';
      }
      this._debugRows.Mode.textContent = mode;
      this._debugRows.Seed.textContent = snapshot.seed != null ? String(snapshot.seed) : '--';
    }
  }

  destroy() {
    clearTimeout(this._heldFadeTimer);
    clearTimeout(this._hurtTimer);
    this.commandBarEl?.removeEventListener('submit', this._onCommandSubmit);
    this.commandInputEl?.removeEventListener('keydown', this._onCommandKeyDown);
    this.container?.replaceChildren();
  }
}
