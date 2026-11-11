import './ui/styles.css';
import * as THREE from 'three';
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  DAY_CYCLE_SECONDS,
  DEFAULT_RENDER_DISTANCE,
  DIFFICULTIES,
  GAME_MODES,
  PLAYER_CONSTANTS,
} from './core/constants.js';
import { isValidY, worldToChunk } from './core/coords.js';
import { BLOCK, getBlockDef, isBlockSolid } from './core/blocks.js';
import { canHarvestBlock, computeBreakTime, getItemDef, ITEM } from './core/items.js';
import { createAtlasTexture, createChunkMaterials, renderItemIconDataUrl } from './render/atlas.js';
import { SkySystem } from './render/sky.js';
import { ParticleSystem } from './render/particles.js';
import { raycastVoxels } from './gameplay/raycast.js';
import { createPlayerState, stepPlayerPhysics, wouldPlaceOverlapPlayer } from './gameplay/physics.js';
import { MobManager } from './gameplay/mobs.js';
import { EntityManager, collectExplosionBlocks } from './gameplay/entities.js';
import { SoundEngine } from './gameplay/audio.js';
import { InventorySystem } from './systems/inventory.js';
import { WorldStorage } from './systems/storage.js';
import { executeSlashCommand } from './systems/commands.js';
import { GameHUD } from './ui/hud.js';
import { GameMenus } from './ui/menus.js';
import { WorldEngine } from './engine/WorldEngine.js';
import { ViewModelSystem } from './engine/ViewModel.js';

const PANORAMA_SEED = 'craftscape-panorama-2026';
const DEFAULT_TIME_OF_DAY = 0.34; // crisp morning light with golden warmth
const AUTOSAVE_INTERVAL_SEC = 30;

function getCardinalFacing(yaw) {
  // Forward in world space: (-sin(yaw), -cos(yaw))
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  if (Math.abs(fx) >= Math.abs(fz)) {
    return fx >= 0 ? 'East (+X)' : 'West (-X)';
  }
  return fz >= 0 ? 'South (+Z)' : 'North (-Z)';
}

function getCameraDirection(yaw, pitch, target = new THREE.Vector3()) {
  const cosPitch = Math.cos(pitch);
  target.set(
    -Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch,
  );
  return target.normalize();
}

function resolveSpawnPoint(world, baseX = 0, baseZ = 0) {
  const found = world.findSafeSpawn(baseX, baseZ);
  return { x: found.x, y: found.y, z: found.z };
}

class CraftScapeApp {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.hudRoot = document.getElementById('hud-root');
    this.menuRoot = document.getElementById('menu-root');

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 320);
    this.camera.rotation.order = 'YXZ';

    this.atlasTexture = createAtlasTexture();
    this.chunkMaterials = createChunkMaterials(this.atlasTexture);
    this.skySystem = new SkySystem(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.viewModel = new ViewModelSystem(this.scene, this.atlasTexture);
    this.soundEngine = new SoundEngine({ volume: 0.6 });
    this.storage = new WorldStorage();

    // Active game & simulation state
    this.phase = 'title'; // 'title' | 'playing' | 'paused' | 'container' | 'dead'
    this.activeWorldMeta = null;
    this.world = null;
    this.inventory = new InventorySystem();
    this.player = createPlayerState({ x: 8.5, y: 64, z: 8.5 });
    this.spawnPos = { x: 8.5, y: 64, z: 8.5 };
    this.mobManager = null;
    this.entityManager = null;

    this.settings = {
      gameMode: GAME_MODES.SURVIVAL,
      difficulty: DIFFICULTIES.NORMAL,
      renderDistance: DEFAULT_RENDER_DISTANCE,
      fov: 75,
      sensitivity: 1.0,
      volume: 0.6,
    };

    this.timeOfDay = DEFAULT_TIME_OF_DAY;
    this.elapsedTime = 0;
    this.panoramaAngle = 0.4;
    this.panoramaFocus = { x: 8.5, y: 56, z: 8.5 };
    this.thirdPerson = false;
    this.currentEyeHeight = PLAYER_CONSTANTS.EYE_HEIGHT;
    this.currentFov = this.settings.fov;

    this.inputState = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      sneak: false,
      sprintKey: false,
    };
    this.sprintLatch = false;
    this._lastWTapTime = 0;
    this._lastSpaceTapTime = 0;
    this._leftMouseDown = false;
    this._rightMouseDown = false;
    this._creativeBreakCooldown = 0;
    this._placeCooldown = 0;
    this._suppressPauseOnUnlock = false;

    this.miningState = {
      wx: 0,
      wy: 0,
      wz: 0,
      blockId: BLOCK.AIR,
      progress: 0,
      swingAccum: 0,
      soundAccum: 0,
      particleAccum: 0,
    };

    this._timers = {
      autosave: AUTOSAVE_INTERVAL_SEC,
      hurtCooldown: 0,
      drownAccum: 0,
      starveAccum: 0,
      regenAccum: 0,
      emberAccum: 0,
      fpsAccum: 0,
      fpsFrames: 0,
    };
    this.currentFps = 60;
    this._lastHit = null;
    this._hurtFlashPending = false;
    this._deathOverlayEl = null;

    this._tmpDir = new THREE.Vector3();
    this._tmpEye = { x: 0, y: 0, z: 0 };

    this.hud = new GameHUD(this.hudRoot, {
      renderIcon: renderItemIconDataUrl,
      onCommand: (raw) => this._handleSlashCommand(raw),
    });
    this.hud.setVisible(false);

    this.menus = new GameMenus(this.menuRoot, {
      renderIcon: renderItemIconDataUrl,
      handlers: {
        onPlayNewWorld: (payload) => this.startNewWorld(payload),
        onLoadWorld: (id) => this.loadSavedWorld(id),
        onDeleteWorld: (id) => this.deleteSavedWorld(id),
        onResume: () => this.resumeFromPause(),
        onUpdateSettings: (partial) => this.applySettings(partial),
        onSaveAndExit: () => this.saveAndExitToTitle(),
        onInventoryChanged: () => this._syncHeldItemVisual(),
        onCloseContainer: () => this._onContainerClosed(),
        onPlayClickSound: () => this.soundEngine.playClick(),
      },
    });

    this._bindEvents();
    this._setupDebugHook();
    this._enterTitleScreen();

    this._lastFrameTime = performance.now();
    this._rafId = requestAnimationFrame((now) => this._loop(now));
  }

  _setupDebugHook() {
    window.__craftscape = {
      getState: () => ({
        phase: this.phase,
        gameMode: this.settings.gameMode,
        difficulty: this.settings.difficulty,
        renderDistance: this.settings.renderDistance,
        timeOfDay: this.timeOfDay,
        loadedChunks: this.world?.getLoadedChunkCount() ?? 0,
        fps: this.currentFps,
        position: { ...this.player.position },
        health: this.inventory.health,
        hunger: this.inventory.hunger,
        flying: this.player.flying,
        thirdPerson: this.thirdPerson,
        mobCount: this.mobManager?.mobs.length ?? 0,
        dropCount: this.entityManager?.drops.length ?? 0,
      }),
      runCommand: (cmd) => this._handleSlashCommand(cmd),
    };
  }

  _bindEvents() {
    this._onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    };
    window.addEventListener('resize', this._onResize);

    this._onPointerLockChange = () => {
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && this.phase === 'playing') {
        if (this._suppressPauseOnUnlock) {
          this._suppressPauseOnUnlock = false;
          return;
        }
        if (this.hud.isCommandBarOpen()) {
          return;
        }
        this.openPauseMenu();
      }
      if (locked) {
        this._suppressPauseOnUnlock = false;
      }
    };
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    this._onMouseMove = (event) => {
      if (this.phase !== 'playing' || document.pointerLockElement !== this.canvas) return;
      const scale = 0.0021 * this.settings.sensitivity;
      this.player.yaw -= event.movementX * scale;
      this.player.pitch = Math.max(
        -Math.PI / 2 + 0.015,
        Math.min(Math.PI / 2 - 0.015, this.player.pitch - event.movementY * scale),
      );
    };
    document.addEventListener('mousemove', this._onMouseMove);

    this._onCanvasMouseDown = (event) => {
      if (this.phase !== 'playing') return;
      if (this.hud.isCommandBarOpen()) return;

      if (document.pointerLockElement !== this.canvas) {
        this._requestPointerLock();
      }

      if (event.button === 0) {
        event.preventDefault();
        this._leftMouseDown = true;
        this._handlePrimaryActionPress();
      } else if (event.button === 1) {
        event.preventDefault();
        this._handlePickBlock();
      } else if (event.button === 2) {
        event.preventDefault();
        this._rightMouseDown = true;
        this._handleSecondaryAction();
        this._placeCooldown = 0.22;
      }
    };
    this.canvas.addEventListener('mousedown', this._onCanvasMouseDown);

    this._onWindowMouseUp = (event) => {
      if (event.button === 0) {
        this._leftMouseDown = false;
        this._resetMiningState();
      } else if (event.button === 2) {
        this._rightMouseDown = false;
      }
    };
    window.addEventListener('mouseup', this._onWindowMouseUp);

    this._onContextMenu = (event) => {
      if (this.phase === 'playing' || this.phase === 'container') {
        event.preventDefault();
      }
    };
    window.addEventListener('contextmenu', this._onContextMenu);

    this._onWheel = (event) => {
      if (this.phase !== 'playing' || this.hud.isCommandBarOpen()) return;
      if (Math.abs(event.deltaY) < 1) return;
      this.inventory.cycleHotbar(event.deltaY > 0 ? 1 : -1);
      this._syncHeldItemVisual();
    };
    window.addEventListener('wheel', this._onWheel, { passive: true });

    this._onKeyDown = (event) => this._handleKeyDown(event);
    this._onKeyUp = (event) => this._handleKeyUp(event);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    this._onBlur = () => this._clearInputs();
    window.addEventListener('blur', this._onBlur);

    this._onBeforeUnload = () => {
      if (this.activeWorldMeta && this.world && this.phase !== 'title') {
        this._saveCurrentWorld({ silent: true });
      }
    };
    window.addEventListener('beforeunload', this._onBeforeUnload);
  }

  _clearInputs() {
    this.inputState.forward = false;
    this.inputState.backward = false;
    this.inputState.left = false;
    this.inputState.right = false;
    this.inputState.jump = false;
    this.inputState.sneak = false;
    this.inputState.sprintKey = false;
    this.sprintLatch = false;
    this._leftMouseDown = false;
    this._rightMouseDown = false;
    this._resetMiningState();
  }

  _resetMiningState() {
    this.miningState.progress = 0;
    this.miningState.blockId = BLOCK.AIR;
  }

  _requestPointerLock() {
    try {
      const maybePromise = this.canvas.requestPointerLock?.();
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    } catch {
      // Ignore pointer lock rejection in headless or sandboxed contexts
    }
  }

  _exitPointerLockSafely(suppressPause = true) {
    if (document.pointerLockElement === this.canvas) {
      this._suppressPauseOnUnlock = suppressPause;
      try {
        document.exitPointerLock?.();
      } catch {
        this._suppressPauseOnUnlock = false;
      }
    }
  }

  _handleKeyDown(event) {
    if (this.phase === 'title') return;

    // Command bar owns keyboard while open
    if (this.hud.isCommandBarOpen()) {
      return;
    }

    if (event.code === 'Escape') {
      event.preventDefault();
      if (this.phase === 'container') {
        this.menus.close();
        this.phase = 'playing';
        this._requestPointerLock();
      } else if (this.phase === 'paused') {
        this.resumeFromPause();
      } else if (this.phase === 'playing') {
        this.openPauseMenu();
      }
      return;
    }

    if (this.phase === 'container') {
      if (event.code === 'KeyE' && !event.repeat) {
        event.preventDefault();
        this.menus.close();
        this.phase = 'playing';
        this._requestPointerLock();
      }
      return;
    }

    if (this.phase !== 'playing') return;

    // Gameplay shortcuts (single press)
    if (!event.repeat) {
      if (event.code === 'KeyE') {
        event.preventDefault();
        this._openContainerModal(
          this.settings.gameMode === GAME_MODES.CREATIVE ? 'creative' : 'inventory',
        );
        return;
      }

      if (event.code === 'KeyT' || event.key === '/') {
        event.preventDefault();
        this._clearInputs();
        this._exitPointerLockSafely(true);
        this.hud.openCommandBar(event.key === '/' ? '/' : '');
        return;
      }

      if (event.code === 'F3') {
        event.preventDefault();
        this.hud.toggleDebug();
        return;
      }

      if (event.code === 'F5') {
        event.preventDefault();
        this.thirdPerson = !this.thirdPerson;
        return;
      }

      if (event.code === 'KeyQ') {
        event.preventDefault();
        this._dropSelectedItem();
        return;
      }

      if (event.code === 'KeyP') {
        event.preventDefault();
        this._handlePickBlock();
        return;
      }

      if (event.code.startsWith('Digit')) {
        const digit = Number(event.code.slice(5));
        if (digit >= 1 && digit <= 9) {
          this.inventory.selectHotbar(digit - 1);
          this._syncHeldItemVisual();
          return;
        }
      }

      // Creative double-tap Space toggles flight
      if (event.code === 'Space' && this.settings.gameMode === GAME_MODES.CREATIVE) {
        const now = performance.now();
        if (now - this._lastSpaceTapTime < 280) {
          this.player.flying = !this.player.flying;
          this.player.velocity.y = 0;
          this._lastSpaceTapTime = 0;
          this.hud.showToast(this.player.flying ? 'Flight enabled' : 'Flight disabled', 1400);
        } else {
          this._lastSpaceTapTime = now;
        }
      }

      // Double-tap W triggers sprint latch cleanly
      if (event.code === 'KeyW') {
        const now = performance.now();
        if (now - this._lastWTapTime < 280) {
          this.sprintLatch = true;
          this._lastWTapTime = 0;
        } else {
          this._lastWTapTime = now;
        }
      }

      // Tap Ctrl (left/right) latches sprint so user never hits browser Ctrl+W shortcut
      if (event.code === 'ControlLeft' || event.code === 'ControlRight') {
        this.sprintLatch = true;
      }
    }

    switch (event.code) {
      case 'KeyW':
        this.inputState.forward = true;
        break;
      case 'KeyS':
        this.inputState.backward = true;
        break;
      case 'KeyA':
        this.inputState.left = true;
        break;
      case 'KeyD':
        this.inputState.right = true;
        break;
      case 'Space':
        event.preventDefault();
        this.inputState.jump = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
      case 'KeyC':
        this.inputState.sneak = true;
        this.sprintLatch = false;
        break;
      case 'ControlLeft':
      case 'ControlRight':
      case 'KeyR':
        this.inputState.sprintKey = true;
        break;
      default:
        break;
    }
  }

  _handleKeyUp(event) {
    switch (event.code) {
      case 'KeyW':
        this.inputState.forward = false;
        this.sprintLatch = false;
        break;
      case 'KeyS':
        this.inputState.backward = false;
        break;
      case 'KeyA':
        this.inputState.left = false;
        break;
      case 'KeyD':
        this.inputState.right = false;
        break;
      case 'Space':
        this.inputState.jump = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
      case 'KeyC':
        this.inputState.sneak = false;
        break;
      case 'ControlLeft':
      case 'ControlRight':
      case 'KeyR':
        this.inputState.sprintKey = false;
        break;
      default:
        break;
    }
  }

  _disposeActiveEntitiesAndWorld() {
    this._removeDeathOverlay();
    this.mobManager?.disposeAll();
    this.mobManager = null;
    this.entityManager?.disposeAll();
    this.entityManager = null;
    this.world?.dispose();
    this.world = null;
  }

  async _enterTitleScreen() {
    this._clearInputs();
    this._exitPointerLockSafely(true);
    this._disposeActiveEntitiesAndWorld();

    this.phase = 'title';
    this.activeWorldMeta = null;
    this.thirdPerson = false;
    this.hud.setVisible(false);
    this.hud.toggleDebug(false);
    this.viewModel.updateTargetHighlight(null, 0);
    this.viewModel.avatar.group.visible = false;

    // Showcase live 3D voxel terrain panorama behind title UI
    this.world = new WorldEngine({
      scene: this.scene,
      seed: PANORAMA_SEED,
      materials: this.chunkMaterials,
      renderDistance: 4,
    });
    this.world.preloadRadius(8, 8, 3);
    const spawn = resolveSpawnPoint(this.world, 8, 8);
    this.panoramaFocus = { x: spawn.x, y: spawn.y + 8, z: spawn.z };
    this.timeOfDay = DEFAULT_TIME_OF_DAY;

    let worlds = [];
    try {
      worlds = await this.storage.listWorlds();
    } catch {
      worlds = [];
    }

    // Re-check phase in case user already triggered launch while storage listed
    if (this.phase === 'title') {
      this.menus.showTitle(worlds, {
        gameMode: this.settings.gameMode,
        difficulty: this.settings.difficulty,
      });
    }
  }

  async startNewWorld({ name, seed, gameMode, difficulty }) {
    this._disposeActiveEntitiesAndWorld();
    this._clearInputs();

    const mode = gameMode === GAME_MODES.CREATIVE ? GAME_MODES.CREATIVE : GAME_MODES.SURVIVAL;
    const diff = difficulty === DIFFICULTIES.PEACEFUL ? DIFFICULTIES.PEACEFUL : DIFFICULTIES.NORMAL;
    const finalSeed = seed && String(seed).trim().length > 0
      ? String(seed).trim()
      : String(Math.floor(100000 + Math.random() * 899999));

    this.settings.gameMode = mode;
    this.settings.difficulty = diff;

    this.world = new WorldEngine({
      scene: this.scene,
      seed: finalSeed,
      materials: this.chunkMaterials,
      renderDistance: this.settings.renderDistance,
    });
    this.world.preloadRadius(0, 0, Math.min(3, this.settings.renderDistance));

    const spawn = resolveSpawnPoint(this.world, 0, 0);
    this.spawnPos = { ...spawn };
    this.player = createPlayerState(spawn);
    this.player.flying = mode === GAME_MODES.CREATIVE;

    this.inventory = new InventorySystem();
    this.inventory.giveStarterKit(mode);

    this.timeOfDay = DEFAULT_TIME_OF_DAY;
    this.thirdPerson = false;

    this._initManagersForActiveWorld();

    const now = Date.now();
    this.activeWorldMeta = {
      id: null,
      name: String(name || 'Emerald Valley').trim() || 'Emerald Valley',
      createdAt: now,
    };

    // Request pointer lock before async IndexedDB save preserves user-gesture context
    this._requestPointerLock();

    const summary = await this._saveCurrentWorld({ silent: true });
    if (summary?.id) {
      this.activeWorldMeta.id = summary.id;
    }

    this._beginActivePlay();
    this.hud.showToast(`Entered "${this.activeWorldMeta.name}" (${mode})`, 2800);
  }

  async loadSavedWorld(worldId) {
    let record = null;
    try {
      record = await this.storage.loadWorld(worldId);
    } catch {
      record = null;
    }
    if (!record) {
      await this._refreshTitleList();
      return;
    }

    this._disposeActiveEntitiesAndWorld();
    this._clearInputs();

    this.settings.gameMode =
      record.gameMode === GAME_MODES.CREATIVE ? GAME_MODES.CREATIVE : GAME_MODES.SURVIVAL;
    this.settings.difficulty =
      record.difficulty === DIFFICULTIES.PEACEFUL ? DIFFICULTIES.PEACEFUL : DIFFICULTIES.NORMAL;

    this.world = new WorldEngine({
      scene: this.scene,
      seed: record.seed ?? 'craftscape-2026',
      materials: this.chunkMaterials,
      renderDistance: this.settings.renderDistance,
      initialDeltas: record.modifiedBlocks ?? null,
    });

    const savedPos = record.player?.position ?? resolveSpawnPoint(this.world, 0, 0);
    this.world.preloadRadius(savedPos.x, savedPos.z, Math.min(3, this.settings.renderDistance));

    this.spawnPos = record.spawn ?? resolveSpawnPoint(this.world, 0, 0);
    this.player = createPlayerState(savedPos);
    this.player.yaw = Number.isFinite(record.player?.yaw) ? record.player.yaw : 0;
    this.player.pitch = Number.isFinite(record.player?.pitch) ? record.player.pitch : 0;
    this.player.flying =
      this.settings.gameMode === GAME_MODES.CREATIVE && Boolean(record.player?.flying);

    this.inventory = new InventorySystem();
    this.inventory.deserialize(record.inventory);

    this.timeOfDay = Number.isFinite(record.timeOfDay) ? record.timeOfDay : DEFAULT_TIME_OF_DAY;
    this.thirdPerson = false;

    this._initManagersForActiveWorld();

    this.activeWorldMeta = {
      id: record.id,
      name: record.name || 'Loaded World',
      createdAt: record.createdAt || Date.now(),
    };

    this._beginActivePlay();
    this.hud.showToast(`Loaded "${this.activeWorldMeta.name}"`, 2400);
  }

  async deleteSavedWorld(worldId) {
    try {
      await this.storage.deleteWorld(worldId);
      this.soundEngine.playBreak('wood');
    } catch {
      // Ignore delete failures safely
    }
    await this._refreshTitleList();
  }

  async _refreshTitleList() {
    let worlds = [];
    try {
      worlds = await this.storage.listWorlds();
    } catch {
      worlds = [];
    }
    if (this.phase === 'title') {
      this.menus.showTitle(worlds, {
        gameMode: this.settings.gameMode,
        difficulty: this.settings.difficulty,
      });
    }
  }

  _initManagersForActiveWorld() {
    const worldAccessor = {
      getBlockAt: (wx, wy, wz) => this.world.getBlockAt(wx, wy, wz),
      setBlockAt: (wx, wy, wz, id) => this.world.setBlockAt(wx, wy, wz, id, { immediateRebuild: false }),
      isWalkableSurface: (wx, wy, wz) => this.world.isWalkableSurface(wx, wy, wz),
    };
    this.mobManager = new MobManager(this.scene, worldAccessor);
    this.entityManager = new EntityManager(this.scene, worldAccessor);
  }

  _beginActivePlay() {
    this.menus.close();
    this.phase = 'playing';
    this.hud.setVisible(true);
    this._syncHeldItemVisual();
    this._timers.autosave = AUTOSAVE_INTERVAL_SEC;
    this._requestPointerLock();
  }

  openPauseMenu() {
    if (this.phase !== 'playing' && this.phase !== 'container') return;
    this._clearInputs();
    this._exitPointerLockSafely(true);
    this.phase = 'paused';
    this._saveCurrentWorld({ silent: true });
    this.menus.showPause({ ...this.settings });
  }

  resumeFromPause() {
    if (this.phase !== 'paused') return;
    this.menus.close();
    this.phase = 'playing';
    this._requestPointerLock();
  }

  async saveAndExitToTitle() {
    await this._saveCurrentWorld({ silent: true });
    await this._enterTitleScreen();
  }

  async _saveCurrentWorld({ silent = false } = {}) {
    if (!this.activeWorldMeta || !this.world) return null;
    try {
      const summary = await this.storage.saveWorld({
        id: this.activeWorldMeta.id ?? undefined,
        name: this.activeWorldMeta.name,
        seed: this.world.seed,
        seedInt: this.world.seedInt,
        gameMode: this.settings.gameMode,
        difficulty: this.settings.difficulty,
        createdAt: this.activeWorldMeta.createdAt,
        updatedAt: Date.now(),
        timeOfDay: this.timeOfDay,
        spawn: { ...this.spawnPos },
        player: {
          position: { ...this.player.position },
          yaw: this.player.yaw,
          pitch: this.player.pitch,
          flying: this.player.flying,
        },
        inventory: this.inventory.serialize(),
        modifiedBlocks: this.world.exportModifiedBlocks(),
      });
      if (summary?.id) {
        this.activeWorldMeta.id = summary.id;
      }
      if (!silent) {
        this.hud.showToast('World saved', 1500);
      }
      return summary;
    } catch {
      return null;
    }
  }

  applySettings(partial) {
    if (!partial || typeof partial !== 'object') return;
    if (partial.gameMode) {
      this.setGameMode(partial.gameMode);
    }
    if (partial.difficulty) {
      this.settings.difficulty =
        partial.difficulty === DIFFICULTIES.PEACEFUL ? DIFFICULTIES.PEACEFUL : DIFFICULTIES.NORMAL;
    }
    if (Number.isFinite(partial.renderDistance)) {
      this.settings.renderDistance = Math.max(3, Math.min(9, Math.round(partial.renderDistance)));
      if (this.world) this.world.renderDistance = this.settings.renderDistance;
    }
    if (Number.isFinite(partial.fov)) {
      this.settings.fov = Math.max(60, Math.min(100, partial.fov));
    }
    if (Number.isFinite(partial.sensitivity)) {
      this.settings.sensitivity = Math.max(0.2, Math.min(2.5, partial.sensitivity));
    }
    if (Number.isFinite(partial.volume)) {
      this.settings.volume = Math.max(0, Math.min(1, partial.volume));
      this.soundEngine.setVolume(this.settings.volume);
    }
  }

  setGameMode(mode) {
    const normalized = mode === GAME_MODES.CREATIVE ? GAME_MODES.CREATIVE : GAME_MODES.SURVIVAL;
    this.settings.gameMode = normalized;
    if (normalized === GAME_MODES.SURVIVAL) {
      this.player.flying = false;
    }
    if (this.menus.getActiveScreen() === 'container') {
      const state = this.menus._containerState;
      if (state) state.gameMode = normalized;
    }
  }

  _openContainerModal(mode, blockKey = null) {
    this._clearInputs();
    this._exitPointerLockSafely(true);
    this.phase = 'container';
    this.menus.openContainer({
      mode,
      inventory: this.inventory,
      blockKey,
      gameMode: this.settings.gameMode,
    });
  }

  _onContainerClosed() {
    if (this.phase === 'container') {
      this.phase = 'playing';
      this._syncHeldItemVisual();
      this._requestPointerLock();
    }
  }

  _syncHeldItemVisual() {
    const stack = this.inventory.getSelectedStack();
    this.viewModel.setHeldItem(stack ? stack.id : null);
  }

  _handleSlashCommand(raw) {
    const result = executeSlashCommand(raw, {
      player: this.player,
      inventory: this.inventory,
      seed: this.world?.seed,
      gameMode: this.settings.gameMode,
      timeOfDay: this.timeOfDay,
      setGameMode: (mode) => this.setGameMode(mode),
      setTime: (t) => {
        this.timeOfDay = t;
      },
      teleport: (x, y, z) => {
        this.player.position.x = x;
        this.player.position.y = y;
        this.player.position.z = z;
        this.player.velocity.x = 0;
        this.player.velocity.y = 0;
        this.player.velocity.z = 0;
        this.player.fallStartY = y;
        this.world?.preloadRadius(x, z, Math.min(3, this.settings.renderDistance));
      },
      heal: () => {
        this.inventory.health = PLAYER_CONSTANTS.MAX_HEALTH;
        this.inventory.hunger = PLAYER_CONSTANTS.MAX_HUNGER;
        this.inventory.oxygen = PLAYER_CONSTANTS.MAX_OXYGEN;
      },
    });
    this._syncHeldItemVisual();
    if (result.ok) this.soundEngine.playClick();
    return result;
  }

  _getEyeOrigin() {
    this._tmpEye.x = this.player.position.x;
    this._tmpEye.y = this.player.position.y + this.currentEyeHeight;
    this._tmpEye.z = this.player.position.z;
    return this._tmpEye;
  }

  _handlePrimaryActionPress() {
    if (!this.world) return;
    const eye = this._getEyeOrigin();
    const dir = getCameraDirection(this.player.yaw, this.player.pitch, this._tmpDir);

    const blockHit = raycastVoxels(
      eye,
      dir,
      PLAYER_CONSTANTS.REACH_DISTANCE,
      (wx, wy, wz) => this.world.getBlockAt(wx, wy, wz),
    );
    const mobReach = blockHit ? Math.min(4.2, blockHit.distance) : 4.2;
    const mobHit = this.mobManager?.raycastMob(eye, dir, mobReach);

    if (mobHit) {
      this._resetMiningState();
      this.viewModel.triggerSwing(0.22);
      const held = this.inventory.getSelectedStack();
      const heldDef = held ? getItemDef(held.id) : null;
      const dmg = heldDef?.damage ?? 1.5;

      this.mobManager.damageMob(
        mobHit.mob.id,
        dmg,
        { x: dir.x, y: 0, z: dir.z },
        (itemId, count, pos) => this.entityManager?.spawnDrop(itemId, count, pos),
      );
      this.soundEngine.playHurt();
      if (this.settings.gameMode === GAME_MODES.SURVIVAL && heldDef?.maxDurability > 0) {
        this.inventory.damageSelectedTool(1);
        this._syncHeldItemVisual();
      }
      return;
    }

    if (blockHit && this.settings.gameMode === GAME_MODES.CREATIVE) {
      this._breakBlockAt(blockHit.wx, blockHit.wy, blockHit.wz, true);
      this._creativeBreakCooldown = 0.16;
    }
  }

  _breakBlockAt(wx, wy, wz, creative = false) {
    const blockId = this.world.getBlockAt(wx, wy, wz);
    if (blockId === BLOCK.AIR) return false;
    if (!creative && !Number.isFinite(getBlockDef(blockId).hardness)) return false;

    const def = getBlockDef(blockId);
    const blockKey = `${wx},${wy},${wz}`;

    // Drop stored container items when breaking Chest or Furnace
    if (blockId === BLOCK.CHEST) {
      const slots = this.inventory.chests.get(blockKey);
      if (slots) {
        for (const s of slots) {
          if (s && s.count > 0) {
            this.entityManager?.spawnDrop(s.id, s.count, { x: wx + 0.5, y: wy + 0.4, z: wz + 0.5 });
          }
        }
        this.inventory.removeChest(blockKey);
      }
    } else if (blockId === BLOCK.FURNACE) {
      const f = this.inventory.furnaces.get(blockKey);
      if (f) {
        for (const s of [f.input, f.fuel, f.output]) {
          if (s && s.count > 0) {
            this.entityManager?.spawnDrop(s.id, s.count, { x: wx + 0.5, y: wy + 0.4, z: wz + 0.5 });
          }
        }
        this.inventory.removeFurnace(blockKey);
      }
    }

    this.world.setBlockAt(wx, wy, wz, BLOCK.AIR, { immediateRebuild: true });
    this.viewModel.triggerSwing(0.2);
    this.soundEngine.playBreak(def.soundGroup);
    this.particles.spawnBlockBreak(wx, wy, wz, def.mapColor, 14);

    if (!creative) {
      const held = this.inventory.getSelectedStack();
      if (blockId === BLOCK.OAK_LEAVES) {
        if (Math.random() < 0.12) {
          this.entityManager?.spawnDrop(ITEM.APPLE, 1, { x: wx + 0.5, y: wy + 0.45, z: wz + 0.5 });
        }
      } else if (canHarvestBlock(def, held?.id)) {
        this.entityManager?.spawnDrop(def.dropId, def.dropCount, {
          x: wx + 0.5,
          y: wy + 0.45,
          z: wz + 0.5,
        });
      }

      if (held && getItemDef(held.id)?.maxDurability > 0) {
        this.inventory.damageSelectedTool(1);
        this._syncHeldItemVisual();
      }
    }

    return true;
  }

  _handleSecondaryAction() {
    if (!this.world) return;
    const eye = this._getEyeOrigin();
    const dir = getCameraDirection(this.player.yaw, this.player.pitch, this._tmpDir);

    const hit = raycastVoxels(
      eye,
      dir,
      PLAYER_CONSTANTS.REACH_DISTANCE,
      (wx, wy, wz) => this.world.getBlockAt(wx, wy, wz),
    );

    if (hit && !this.player.sneaking) {
      const targetDef = getBlockDef(hit.blockId);
      if (targetDef.interactive) {
        const blockKey = `${hit.wx},${hit.wy},${hit.wz}`;
        if (hit.blockId === BLOCK.CRAFTING_TABLE) {
          this.soundEngine.playClick();
          this._openContainerModal('crafting');
          return;
        }
        if (hit.blockId === BLOCK.FURNACE) {
          this.soundEngine.playClick();
          this._openContainerModal('furnace', blockKey);
          return;
        }
        if (hit.blockId === BLOCK.CHEST) {
          this.soundEngine.playClick();
          this._openContainerModal('chest', blockKey);
          return;
        }
        if (hit.blockId === BLOCK.TNT) {
          this.world.setBlockAt(hit.wx, hit.wy, hit.wz, BLOCK.AIR, { immediateRebuild: true });
          this.entityManager?.spawnPrimedTnt(hit.wx, hit.wy, hit.wz);
          this.soundEngine.playFuse();
          this.viewModel.triggerSwing(0.18);
          return;
        }
      }
    }

    const held = this.inventory.getSelectedStack();
    const heldDef = held ? getItemDef(held.id) : null;
    if (!held || !heldDef) return;

    // Food consumption
    if (heldDef.hunger > 0 && this.settings.gameMode === GAME_MODES.SURVIVAL) {
      if (this.inventory.eatSelectedFood()) {
        this.soundEngine.playPlace('grass');
        this.viewModel.triggerSwing(0.22);
        this._syncHeldItemVisual();
        return;
      }
    }

    if (!hit || !heldDef.placeable) return;

    const hitDef = getBlockDef(hit.blockId);
    const targetPos = hitDef.replaceable
      ? { wx: hit.wx, wy: hit.wy, wz: hit.wz }
      : hit.placePos;

    if (!isValidY(targetPos.wy)) return;

    const existing = this.world.getBlockAt(targetPos.wx, targetPos.wy, targetPos.wz);
    if (existing !== BLOCK.AIR && !getBlockDef(existing).replaceable) return;

    // Prevent trapping player inside solid block placed on self
    if (isBlockSolid(heldDef.blockId) && wouldPlaceOverlapPlayer(targetPos, this.player.position)) {
      return;
    }

    const placed = this.world.setBlockAt(
      targetPos.wx,
      targetPos.wy,
      targetPos.wz,
      heldDef.blockId,
      { immediateRebuild: true },
    );

    if (placed) {
      const placeDef = getBlockDef(heldDef.blockId);
      this.soundEngine.playPlace(placeDef.soundGroup);
      this.viewModel.triggerSwing(0.18);
      if (this.settings.gameMode === GAME_MODES.SURVIVAL) {
        this.inventory.consumeSlot(this.inventory.selectedHotbar, 1);
        this._syncHeldItemVisual();
      }
    }
  }

  _handlePickBlock() {
    if (!this.world) return;
    const eye = this._getEyeOrigin();
    const dir = getCameraDirection(this.player.yaw, this.player.pitch, this._tmpDir);
    const hit = raycastVoxels(
      eye,
      dir,
      PLAYER_CONSTANTS.REACH_DISTANCE,
      (wx, wy, wz) => this.world.getBlockAt(wx, wy, wz),
    );
    if (!hit) return;

    const itemDef = getItemDef(hit.blockId);
    if (!itemDef || !itemDef.placeable) return;

    const existingHotbarIdx = this.inventory.slots
      .slice(0, 9)
      .findIndex((s) => s && s.id === itemDef.id);

    if (existingHotbarIdx >= 0) {
      this.inventory.selectHotbar(existingHotbarIdx);
    } else if (this.settings.gameMode === GAME_MODES.CREATIVE) {
      this.inventory.slots[this.inventory.selectedHotbar] = {
        id: itemDef.id,
        count: itemDef.stackSize ?? 64,
      };
    } else {
      const backpackIdx = this.inventory.slots.findIndex((s, i) => i >= 9 && s && s.id === itemDef.id);
      if (backpackIdx >= 0) {
        const tmp = this.inventory.slots[this.inventory.selectedHotbar];
        this.inventory.slots[this.inventory.selectedHotbar] = this.inventory.slots[backpackIdx];
        this.inventory.slots[backpackIdx] = tmp;
      }
    }
    this._syncHeldItemVisual();
    this.soundEngine.playClick();
  }

  _dropSelectedItem() {
    const stack = this.inventory.getSelectedStack();
    if (!stack || stack.count <= 0) return;

    const eye = this._getEyeOrigin();
    const dir = getCameraDirection(this.player.yaw, this.player.pitch, this._tmpDir);
    const spawnPos = {
      x: eye.x + dir.x * 0.9,
      y: eye.y - 0.15 + dir.y * 0.9,
      z: eye.z + dir.z * 0.9,
    };
    const velocity = {
      x: dir.x * 5.2,
      y: Math.max(1.5, dir.y * 4.5 + 1.8),
      z: dir.z * 5.2,
    };

    const drop = this.entityManager?.spawnDrop(stack.id, 1, spawnPos, velocity);
    if (drop) drop.pickupDelay = 0.75;

    this.inventory.consumeSlot(this.inventory.selectedHotbar, 1);
    this._syncHeldItemVisual();
    this.viewModel.triggerSwing(0.18);
  }

  _applyExplosionEffects(cx, cy, cz, radius, damageBlocksToo = false) {
    if (damageBlocksToo && this.world) {
      const affected = collectExplosionBlocks(
        cx,
        cy,
        cz,
        radius,
        (wx, wy, wz) => this.world.getBlockAt(wx, wy, wz),
      );
      for (const cell of affected) {
        if (cell.blockId === BLOCK.TNT) {
          this.world.setBlockAt(cell.wx, cell.wy, cell.wz, BLOCK.AIR, { immediateRebuild: false });
          this.entityManager?.spawnPrimedTnt(cell.wx, cell.wy, cell.wz, 0.4);
          continue;
        }
        this.world.setBlockAt(cell.wx, cell.wy, cell.wz, BLOCK.AIR, { immediateRebuild: false });
        const def = getBlockDef(cell.blockId);
        if (def.dropId != null && Math.random() < 0.35) {
          this.entityManager?.spawnDrop(def.dropId, def.dropCount, {
            x: cell.wx + 0.5,
            y: cell.wy + 0.5,
            z: cell.wz + 0.5,
          });
        }
      }
      if (this.settings.gameMode === GAME_MODES.SURVIVAL) {
        const dist = Math.hypot(
          this.player.position.x - cx,
          this.player.position.y + 0.9 - cy,
          this.player.position.z - cz,
        );
        if (dist <= radius * 1.7) {
          const dmg = Math.max(1, Math.round((1 - dist / (radius * 1.7)) * 12));
          this._damagePlayer(dmg, 'Explosion', true);
        }
      }
    }

    this.world?.flushRebuilds();
    this.particles.spawnExplosion(cx, cy, cz, 34);
    this.soundEngine.playExplosion();

    // Blast damage to nearby mobs
    if (this.mobManager) {
      const blastRange = radius * 1.75;
      const snapshot = [...this.mobManager.mobs];
      for (const mob of snapshot) {
        const dx = mob.position.x - cx;
        const dy = mob.position.y + 0.5 - cy;
        const dz = mob.position.z - cz;
        const d = Math.hypot(dx, dy, dz);
        if (d <= blastRange) {
          const dmg = Math.max(2, Math.round((1 - d / blastRange) * 18));
          this.mobManager.damageMob(
            mob.id,
            dmg,
            { x: dx, y: 0, z: dz },
            (itemId, count, pos) => this.entityManager?.spawnDrop(itemId, count, pos),
          );
        }
      }
    }
  }

  _damagePlayer(amount, _reason = '', bypassCooldown = false) {
    if (this.settings.gameMode !== GAME_MODES.SURVIVAL || this.phase !== 'playing') return;
    if (!bypassCooldown && this._timers.hurtCooldown > 0) return;

    this.inventory.health = Math.max(0, this.inventory.health - amount);
    this._hurtFlashPending = true;
    this.soundEngine.playHurt();
    if (!bypassCooldown) {
      this._timers.hurtCooldown = 0.45;
    }

    if (this.inventory.health <= 0) {
      this._handlePlayerDeath();
    }
  }

  _handlePlayerDeath() {
    this._clearInputs();
    this._exitPointerLockSafely(true);
    this.phase = 'dead';
    this._showDeathOverlay();
  }

  _showDeathOverlay() {
    this._removeDeathOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'cs-overlay cs-overlay--dim';

    const card = document.createElement('section');
    card.className = 'cs-panel cs-pause-card';

    const title = document.createElement('h2');
    title.className = 'cs-pause-title';
    title.style.color = '#ff7b74';
    title.textContent = 'YOU DIED';

    const msg = document.createElement('p');
    msg.style.margin = '0';
    msg.style.fontSize = '13px';
    msg.style.color = 'var(--ink-muted)';
    msg.textContent = 'Your journey was cut short. Respawn cleanly back at world spawn.';

    const actions = document.createElement('div');
    actions.className = 'cs-pause-actions';

    const respawnBtn = document.createElement('button');
    respawnBtn.type = 'button';
    respawnBtn.className = 'cs-btn cs-btn--primary';
    respawnBtn.textContent = 'Respawn at Spawn';
    respawnBtn.addEventListener('click', () => {
      this.soundEngine.playClick();
      this._respawnPlayer();
    });

    const exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.className = 'cs-btn cs-btn--gold';
    exitBtn.textContent = 'Save & Exit to Title';
    exitBtn.addEventListener('click', () => {
      this.soundEngine.playClick();
      this.saveAndExitToTitle();
    });

    actions.append(respawnBtn, exitBtn);
    card.append(title, msg, actions);
    overlay.appendChild(card);
    this.menuRoot.appendChild(overlay);
    this._deathOverlayEl = overlay;
  }

  _removeDeathOverlay() {
    if (this._deathOverlayEl) {
      this._deathOverlayEl.remove();
      this._deathOverlayEl = null;
    }
  }

  _respawnPlayer() {
    this._removeDeathOverlay();
    const safe = resolveSpawnPoint(this.world, Math.floor(this.spawnPos.x), Math.floor(this.spawnPos.z));
    this.player = createPlayerState(safe);
    this.inventory.health = PLAYER_CONSTANTS.MAX_HEALTH;
    this.inventory.hunger = PLAYER_CONSTANTS.MAX_HUNGER;
    this.inventory.oxygen = PLAYER_CONSTANTS.MAX_OXYGEN;
    this.world.preloadRadius(safe.x, safe.z, Math.min(3, this.settings.renderDistance));
    this.phase = 'playing';
    this._requestPointerLock();
    this.hud.showToast('Respawned at world spawn', 2000);
  }

  _updateSurvivalVitals(dt, isMoving) {
    if (this.settings.gameMode !== GAME_MODES.SURVIVAL) {
      this.inventory.health = PLAYER_CONSTANTS.MAX_HEALTH;
      this.inventory.hunger = PLAYER_CONSTANTS.MAX_HUNGER;
      this.inventory.oxygen = PLAYER_CONSTANTS.MAX_OXYGEN;
      return;
    }

    if (this._timers.hurtCooldown > 0) {
      this._timers.hurtCooldown = Math.max(0, this._timers.hurtCooldown - dt);
    }

    // Drowning
    if (this.player.headInWater) {
      this.inventory.oxygen = Math.max(0, this.inventory.oxygen - dt * 2.0);
      if (this.inventory.oxygen <= 0) {
        this._timers.drownAccum += dt;
        if (this._timers.drownAccum >= 1.0) {
          this._timers.drownAccum -= 1.0;
          this._damagePlayer(2, 'Drowned', true);
        }
      }
    } else {
      this._timers.drownAccum = 0;
      this.inventory.oxygen = Math.min(PLAYER_CONSTANTS.MAX_OXYGEN, this.inventory.oxygen + dt * 8.0);
    }

    // Lava, Cactus & Void hazards
    const px = Math.floor(this.player.position.x);
    const pyFoot = Math.floor(this.player.position.y + 0.15);
    const pyBody = Math.floor(this.player.position.y + 0.9);
    const pz = Math.floor(this.player.position.z);

    const bFoot = this.world.getBlockAt(px, pyFoot, pz);
    const bBody = this.world.getBlockAt(px, pyBody, pz);

    if (bFoot === BLOCK.LAVA || bBody === BLOCK.LAVA) {
      this._damagePlayer(4, 'Lava');
    } else if (this.player.position.y < -12) {
      this._damagePlayer(4, 'Void');
    } else {
      // Check cactus touching bounding box
      const hw = PLAYER_CONSTANTS.HALF_WIDTH + 0.05;
      const minX = Math.floor(this.player.position.x - hw);
      const maxX = Math.floor(this.player.position.x + hw);
      const minZ = Math.floor(this.player.position.z - hw);
      const maxZ = Math.floor(this.player.position.z + hw);
      let hitCactus = false;
      for (let y = pyFoot; y <= pyBody && !hitCactus; y++) {
        for (let z = minZ; z <= maxZ && !hitCactus; z++) {
          for (let x = minX; x <= maxX; x++) {
            if (this.world.getBlockAt(x, y, z) === BLOCK.CACTUS) {
              hitCactus = true;
              break;
            }
          }
        }
      }
      if (hitCactus) {
        this._damagePlayer(1, 'Cactus');
      }
    }

    // Hunger drain from movement/sprinting
    if (isMoving) {
      const drain = this.player.sprinting ? 0.08 : 0.015;
      this.inventory.hunger = Math.max(0, this.inventory.hunger - drain * dt);
    }

    // Natural regen vs starvation
    if (this.inventory.hunger >= 18 && this.inventory.health < PLAYER_CONSTANTS.MAX_HEALTH) {
      this._timers.regenAccum += dt;
      if (this._timers.regenAccum >= 3.5) {
        this._timers.regenAccum = 0;
        this.inventory.health = Math.min(PLAYER_CONSTANTS.MAX_HEALTH, this.inventory.health + 1);
        this.inventory.hunger = Math.max(0, this.inventory.hunger - 0.35);
      }
    } else {
      this._timers.regenAccum = 0;
    }

    if (this.inventory.hunger <= 0 && this.settings.difficulty === DIFFICULTIES.NORMAL) {
      this._timers.starveAccum += dt;
      if (this._timers.starveAccum >= 4.0) {
        this._timers.starveAccum = 0;
        if (this.inventory.health > 1) {
          this._damagePlayer(1, 'Starvation', true);
        }
      }
    } else {
      this._timers.starveAccum = 0;
    }
  }

  _spawnNearbyTorchEmbers(dt) {
    this._timers.emberAccum += dt;
    if (this._timers.emberAccum < 0.28 || !this.world) return;
    this._timers.emberAccum = 0;

    const px = Math.floor(this.player.position.x);
    const py = Math.floor(this.player.position.y + 1);
    const pz = Math.floor(this.player.position.z);

    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -7; dz <= 7; dz++) {
        for (let dx = -7; dx <= 7; dx++) {
          const wx = px + dx;
          const wy = py + dy;
          const wz = pz + dz;
          if (!isValidY(wy)) continue;
          if (this.world.getBlockAt(wx, wy, wz) === BLOCK.TORCH && Math.random() < 0.4) {
            this.particles.spawnTorchEmber(wx, wy, wz);
          }
        }
      }
    }
  }

  _updateContinuousMining(dt) {
    if (
      this.phase !== 'playing' ||
      !this._leftMouseDown ||
      this.hud.isCommandBarOpen() ||
      !this._lastHit
    ) {
      return;
    }

    if (this.settings.gameMode === GAME_MODES.CREATIVE) {
      this._creativeBreakCooldown -= dt;
      if (this._creativeBreakCooldown <= 0) {
        this._breakBlockAt(this._lastHit.wx, this._lastHit.wy, this._lastHit.wz, true);
        this._creativeBreakCooldown = 0.16;
      }
      return;
    }

    const hit = this._lastHit;
    if (
      this.miningState.wx !== hit.wx ||
      this.miningState.wy !== hit.wy ||
      this.miningState.wz !== hit.wz ||
      this.miningState.blockId !== hit.blockId
    ) {
      this.miningState.wx = hit.wx;
      this.miningState.wy = hit.wy;
      this.miningState.wz = hit.wz;
      this.miningState.blockId = hit.blockId;
      this.miningState.progress = 0;
      this.miningState.swingAccum = 0.2;
      this.miningState.soundAccum = 0.25;
      this.miningState.particleAccum = 0.1;
    }

    const def = getBlockDef(hit.blockId);
    const held = this.inventory.getSelectedStack();
    const breakTime = computeBreakTime(def, held?.id);
    if (!Number.isFinite(breakTime)) {
      this.miningState.progress = 0;
      return;
    }

    this.miningState.progress += dt / breakTime;
    this.miningState.swingAccum += dt;
    this.miningState.soundAccum += dt;
    this.miningState.particleAccum += dt;

    if (this.miningState.swingAccum >= 0.23) {
      this.miningState.swingAccum = 0;
      this.viewModel.triggerSwing(0.22);
    }
    if (this.miningState.soundAccum >= 0.26) {
      this.miningState.soundAccum = 0;
      this.soundEngine.playMineHit(def.soundGroup);
    }
    if (this.miningState.particleAccum >= 0.14) {
      this.miningState.particleAccum = 0;
      this.particles.spawnBlockBreak(hit.wx, hit.wy, hit.wz, def.mapColor, 2);
    }

    if (this.miningState.progress >= 1.0) {
      this._breakBlockAt(hit.wx, hit.wy, hit.wz, false);
      this._resetMiningState();
    }
  }

  _updateCamera(dt, isMoving) {
    const targetEye = this.player.sneaking
      ? PLAYER_CONSTANTS.SNEAK_EYE_HEIGHT
      : PLAYER_CONSTANTS.EYE_HEIGHT;
    this.currentEyeHeight += (targetEye - this.currentEyeHeight) * (1 - Math.exp(-16 * dt));

    const eyeX = this.player.position.x;
    const eyeY = this.player.position.y + this.currentEyeHeight;
    const eyeZ = this.player.position.z;

    // Sprint FOV kick
    const targetFov = this.player.sprinting ? this.settings.fov + 7 : this.settings.fov;
    if (Math.abs(targetFov - this.currentFov) > 0.01) {
      this.currentFov += (targetFov - this.currentFov) * (1 - Math.exp(-12 * dt));
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.rotation.y = this.player.yaw;
    this.camera.rotation.x = this.player.pitch;
    this.camera.rotation.z = 0;

    if (this.thirdPerson) {
      const dir = getCameraDirection(this.player.yaw, this.player.pitch, this._tmpDir);
      let dist = 3.6;
      for (let d = 0.4; d <= 3.6; d += 0.25) {
        const sx = Math.floor(eyeX - dir.x * d);
        const sy = Math.floor(eyeY - dir.y * d);
        const sz = Math.floor(eyeZ - dir.z * d);
        if (isBlockSolid(this.world.getBlockAt(sx, sy, sz))) {
          dist = Math.max(0.5, d - 0.3);
          break;
        }
      }
      this.camera.position.set(eyeX - dir.x * dist, eyeY - dir.y * dist, eyeZ - dir.z * dist);
    } else {
      const bobY =
        isMoving && this.player.onGround && !this.player.flying
          ? Math.abs(Math.sin(this.player.walkDistance * Math.PI * 0.9)) * 0.038
          : 0;
      this.camera.position.set(eyeX, eyeY + bobY, eyeZ);
    }
  }

  _updateHudSnapshot() {
    const pos = this.player.position;
    const chunk = worldToChunk(Math.floor(pos.x), Math.floor(pos.z));
    const eyeBlockY = Math.max(0, Math.min(CHUNK_HEIGHT - 1, Math.floor(pos.y + this.currentEyeHeight)));
    const light = this.world?.getLightAt(Math.floor(pos.x), eyeBlockY, Math.floor(pos.z)) ?? {
      sky: 15,
      block: 0,
    };

    const targetDef = this._lastHit ? getBlockDef(this._lastHit.blockId) : null;
    const hurtFlash = this._hurtFlashPending;
    this._hurtFlashPending = false;

    this.hud.updateState({
      gameMode: this.settings.gameMode,
      health: this.inventory.health,
      hunger: this.inventory.hunger,
      oxygen: this.inventory.oxygen,
      submerged: this.player.headInWater,
      hurtFlash,
      slots: this.inventory.slots,
      selectedHotbar: this.inventory.selectedHotbar,
      fps: this.currentFps,
      position: pos,
      chunk,
      biome: this.world?.getBiomeAt(Math.floor(pos.x), Math.floor(pos.z)) ?? 'plains',
      light,
      facing: getCardinalFacing(this.player.yaw),
      targetBlock: this._lastHit && targetDef
        ? {
            name: targetDef.name,
            x: this._lastHit.wx,
            y: this._lastHit.wy,
            z: this._lastHit.wz,
          }
        : null,
      seed: this.world?.seed ?? '--',
    });
  }

  _syncSkyAndMaterials(dt, focusPos, fogDistance, isUnderwater) {
    const skyState = this.skySystem.update(dt, this.timeOfDay, focusPos, fogDistance, isUnderwater);
    const u = this.chunkMaterials.uniforms;
    u.uSunIntensity.value = skyState.sunIntensity;
    u.uFogColor.value.setHex(skyState.fogColorHex);
    u.uFogNear.value = this.scene.fog ? this.scene.fog.near : fogDistance * 0.56;
    u.uFogFar.value = this.scene.fog ? this.scene.fog.far : fogDistance * 0.98;
    u.uUnderwater.value = isUnderwater ? 1.0 : 0.0;
    u.uTime.value = this.elapsedTime;
    return skyState;
  }

  _loop(now) {
    const rawDt = Math.min((now - this._lastFrameTime) / 1000, 0.1);
    this._lastFrameTime = now;
    this.elapsedTime += rawDt;

    this._timers.fpsAccum += rawDt;
    this._timers.fpsFrames += 1;
    if (this._timers.fpsAccum >= 0.4) {
      this.currentFps = Math.round(this._timers.fpsFrames / this._timers.fpsAccum);
      this._timers.fpsAccum = 0;
      this._timers.fpsFrames = 0;
    }

    const fogDistance = this.settings.renderDistance * CHUNK_SIZE;

    if (this.phase === 'title') {
      this.panoramaAngle += rawDt * 0.11;
      const radius = 26;
      const cx = this.panoramaFocus.x + Math.cos(this.panoramaAngle) * radius;
      const cz = this.panoramaFocus.z + Math.sin(this.panoramaAngle) * radius;
      const cy = this.panoramaFocus.y + Math.sin(this.panoramaAngle * 0.7) * 2.2;
      this.camera.position.set(cx, cy, cz);
      this.camera.lookAt(this.panoramaFocus.x, this.panoramaFocus.y - 6, this.panoramaFocus.z);
      this.world?.updateAroundPlayer(this.panoramaFocus.x, this.panoramaFocus.z, {
        maxNewChunks: 2,
        maxMeshRebuilds: 2,
      });
      this._syncSkyAndMaterials(rawDt, this.panoramaFocus, 64, false);
      this.renderer.render(this.scene, this.camera);
    } else if (this.world) {
      const simActive = this.phase === 'playing' || this.phase === 'container';
      if (simActive) {
        this.timeOfDay = (this.timeOfDay + rawDt / DAY_CYCLE_SECONDS) % 1;
      }

      const controlsActive = this.phase === 'playing' && !this.hud.isCommandBarOpen();
      const prevPlayerX = this.player.position.x;
      const prevPlayerZ = this.player.position.z;

      const physicsInput = controlsActive
        ? {
            forward: this.inputState.forward,
            backward: this.inputState.backward,
            left: this.inputState.left,
            right: this.inputState.right,
            jump: this.inputState.jump,
            sneak: this.inputState.sneak,
            sprint: this.inputState.sprintKey || this.sprintLatch,
          }
        : {};

      if (simActive) {
        stepPlayerPhysics(
          this.player,
          physicsInput,
          rawDt,
          (wx, wy, wz) => this.world.getBlockAt(wx, wy, wz),
          {
            onFallDamage: (dmg) => {
              if (this.settings.gameMode === GAME_MODES.SURVIVAL) {
                this._damagePlayer(dmg, 'Fall', true);
              }
            },
            onStep: (group) => this.soundEngine.playStep(group),
          },
        );
      }

      const movedHoriz = Math.hypot(
        this.player.position.x - prevPlayerX,
        this.player.position.z - prevPlayerZ,
      );
      const isMoving = movedHoriz > 0.002;

      if (this.phase === 'playing') {
        this._updateSurvivalVitals(rawDt, isMoving);
      }

      // Tick furnaces in background during play or while viewing furnace UI
      if (simActive && this.inventory.tickFurnaces(rawDt)) {
        if (this.phase === 'container') {
          this.menus.refresh();
        }
      }

      // Stream chunks around player
      this.world.updateAroundPlayer(this.player.position.x, this.player.position.z, {
        maxNewChunks: 2,
        maxMeshRebuilds: 4,
      });

      this._updateCamera(rawDt, isMoving);
      const skyState = this._syncSkyAndMaterials(
        rawDt,
        this.player.position,
        fogDistance,
        this.player.headInWater,
      );

      const isDaytime = skyState.phaseName !== 'night';

      if (simActive) {
        this.entityManager?.update(rawDt, this.player.position, {
          onPickup: (itemId, count) => {
            const added = this.inventory.addItem(itemId, count);
            if (added > 0) {
              this.soundEngine.playPickup();
              this._syncHeldItemVisual();
              return added === count;
            }
            return false;
          },
          onPlayerDamage: (dmg) => this._damagePlayer(dmg, 'Explosion', true),
          onExplode: (cx, cy, cz, radius) => this._applyExplosionEffects(cx, cy, cz, radius, false),
        });

        this.mobManager?.update(rawDt, this.player.position, isDaytime, this.settings.difficulty, {
          onPlayerDamage: (dmg) => this._damagePlayer(dmg, 'Mob'),
          onExplode: (ex, ey, ez, radius) => this._applyExplosionEffects(ex, ey, ez, radius, true),
          onDrop: (itemId, count, pos) => this.entityManager?.spawnDrop(itemId, count, pos),
        });
      }

      // Raycast target block
      if (this.phase === 'playing' && !this.hud.isCommandBarOpen()) {
        const eye = this._getEyeOrigin();
        const dir = getCameraDirection(this.player.yaw, this.player.pitch, this._tmpDir);
        this._lastHit = raycastVoxels(
          eye,
          dir,
          PLAYER_CONSTANTS.REACH_DISTANCE,
          (wx, wy, wz) => this.world.getBlockAt(wx, wy, wz),
        );

        if (this._rightMouseDown && !this._leftMouseDown) {
          this._placeCooldown -= rawDt;
          if (this._placeCooldown <= 0) {
            this._handleSecondaryAction();
            this._placeCooldown = 0.22;
          }
        }
        this._updateContinuousMining(rawDt);
      } else {
        this._lastHit = null;
        this._resetMiningState();
      }

      this._spawnNearbyTorchEmbers(rawDt);
      this.particles.update(rawDt);

      this.viewModel.updateTargetHighlight(
        this._lastHit,
        this.settings.gameMode === GAME_MODES.SURVIVAL ? this.miningState.progress : 0,
      );
      this.viewModel.update({
        dt: rawDt,
        player: this.player,
        isMoving,
        thirdPerson: this.thirdPerson,
        aspect: this.camera.aspect,
      });

      this._updateHudSnapshot();

      // Auto-save periodically during active play
      if (this.phase === 'playing') {
        this._timers.autosave -= rawDt;
        if (this._timers.autosave <= 0) {
          this._timers.autosave = AUTOSAVE_INTERVAL_SEC;
          this._saveCurrentWorld({ silent: true });
        }
      }

      this.renderer.render(this.scene, this.camera);
      this.viewModel.renderOverlay(this.renderer, !this.thirdPerson && this.phase === 'playing');
    }

    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new CraftScapeApp();
});
