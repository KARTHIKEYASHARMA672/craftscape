import { describe, it, expect, vi } from 'vitest';
import { BLOCK } from '../src/core/blocks.js';
import { ITEM } from '../src/core/items.js';
import { raycastVoxels } from '../src/gameplay/raycast.js';
import {
  createPlayerState,
  overlapsSolidBlock,
  wouldPlaceOverlapPlayer,
  stepPlayerPhysics,
} from '../src/gameplay/physics.js';
import { MOB_TYPE, MobManager } from '../src/gameplay/mobs.js';
import { EntityManager, collectExplosionBlocks } from '../src/gameplay/entities.js';
import { SoundEngine } from '../src/gameplay/audio.js';

function makeWorld(entries = []) {
  const map = new Map();
  for (const [wx, wy, wz, id] of entries) {
    map.set(`${wx},${wy},${wz}`, id);
  }
  return {
    getBlockAt: (wx, wy, wz) => map.get(`${wx},${wy},${wz}`) ?? BLOCK.AIR,
    setBlockAt: (wx, wy, wz, id) => {
      if (id === BLOCK.AIR) map.delete(`${wx},${wy},${wz}`);
      else map.set(`${wx},${wy},${wz}`, id);
    },
  };
}

describe('raycastVoxels', () => {
  it('hits exact front face with correct normal and placePos', () => {
    const world = makeWorld([[0, 5, 3, BLOCK.STONE]]);
    const hit = raycastVoxels(
      { x: 0.5, y: 5.5, z: 0.5 },
      { x: 0, y: 0, z: 1 },
      6,
      world.getBlockAt,
    );

    expect(hit).not.toBeNull();
    expect(hit.hit).toBe(true);
    expect(hit.wx).toBe(0);
    expect(hit.wy).toBe(5);
    expect(hit.wz).toBe(3);
    expect(hit.blockId).toBe(BLOCK.STONE);
    expect(hit.normal).toEqual({ x: 0, y: 0, z: -1 });
    expect(hit.placePos).toEqual({ wx: 0, wy: 5, wz: 2 });
    expect(hit.distance).toBeCloseTo(2.5, 5);
  });

  it('skips AIR and WATER by default, and hits WATER when includeLiquids is true', () => {
    const world = makeWorld([
      [0, 5, 2, BLOCK.WATER],
      [0, 5, 4, BLOCK.COBBLESTONE],
    ]);

    const skipLiquidHit = raycastVoxels(
      { x: 0.5, y: 5.5, z: 0.5 },
      { x: 0, y: 0, z: 1 },
      6,
      world.getBlockAt,
    );
    expect(skipLiquidHit.blockId).toBe(BLOCK.COBBLESTONE);
    expect(skipLiquidHit.wz).toBe(4);

    const liquidHit = raycastVoxels(
      { x: 0.5, y: 5.5, z: 0.5 },
      { x: 0, y: 0, z: 1 },
      6,
      world.getBlockAt,
      { includeLiquids: true },
    );
    expect(liquidHit.blockId).toBe(BLOCK.WATER);
    expect(liquidHit.wz).toBe(2);
    expect(liquidHit.normal).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('returns null beyond maxDist', () => {
    const world = makeWorld([[0, 5, 8, BLOCK.STONE]]);
    const miss = raycastVoxels(
      { x: 0.5, y: 5.5, z: 0.5 },
      { x: 0, y: 0, z: 1 },
      5.5,
      world.getBlockAt,
    );
    expect(miss).toBeNull();
  });
});

describe('player physics', () => {
  it('settles onto stone floor at y = 43 on top of y = 42 block', () => {
    const floorBlocks = [];
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        floorBlocks.push([x, 42, z, BLOCK.STONE]);
      }
    }
    const world = makeWorld(floorBlocks);
    const player = createPlayerState({ x: 0.5, y: 45, z: 0.5 });

    for (let i = 0; i < 40; i++) {
      stepPlayerPhysics(player, {}, 0.05, world.getBlockAt);
    }

    expect(player.position.y).toBeCloseTo(43, 5);
    expect(player.onGround).toBe(true);
    expect(player.velocity.y).toBe(0);
    expect(overlapsSolidBlock(player.position, world.getBlockAt)).toBe(false);
  });

  it('prevents walking through a solid wall', () => {
    const blocks = [];
    for (let x = -2; x <= 2; x++) {
      for (let z = -4; z <= 2; z++) {
        blocks.push([x, 42, z, BLOCK.STONE]);
      }
    }
    // Wall across z = -1 (occupies z in [-1, 0])
    for (let x = -2; x <= 2; x++) {
      blocks.push([x, 43, -1, BLOCK.STONE]);
      blocks.push([x, 44, -1, BLOCK.STONE]);
    }
    const world = makeWorld(blocks);
    const player = createPlayerState({ x: 0.5, y: 43, z: 1.5 });
    player.onGround = true;

    for (let i = 0; i < 30; i++) {
      stepPlayerPhysics(player, { forward: true }, 0.05, world.getBlockAt);
    }

    // Player edge z - 0.3 must stay >= 0 (outside wall block at z in [-1, 0])
    expect(player.position.z).toBeGreaterThanOrEqual(0.2999);
    expect(overlapsSolidBlock(player.position, world.getBlockAt)).toBe(false);
  });

  it('activates sneak edge-guard so player stays on ledge', () => {
    // Single platform strip ending at z = 0
    const world = makeWorld([
      [0, 42, 0, BLOCK.STONE],
      [0, 42, 1, BLOCK.STONE],
    ]);
    const player = createPlayerState({ x: 0.5, y: 43, z: 0.5 });
    player.onGround = true;

    for (let i = 0; i < 40; i++) {
      stepPlayerPhysics(player, { forward: true, sneak: true }, 0.05, world.getBlockAt);
    }

    expect(player.position.y).toBeCloseTo(43, 5);
    expect(player.onGround).toBe(true);
    expect(player.position.z).toBeGreaterThan(-0.31);
  });

  it('prevents placing block overlapping player', () => {
    const playerPos = { x: 0.5, y: 43, z: 0.5 };

    expect(wouldPlaceOverlapPlayer({ wx: 0, wy: 43, wz: 0 }, playerPos)).toBe(true);
    expect(wouldPlaceOverlapPlayer({ wx: 0, wy: 44, wz: 0 }, playerPos)).toBe(true);
    expect(wouldPlaceOverlapPlayer({ wx: 0, wy: 42, wz: 0 }, playerPos)).toBe(false);
    expect(wouldPlaceOverlapPlayer({ wx: 0, wy: 45, wz: 0 }, playerPos)).toBe(false);
    expect(wouldPlaceOverlapPlayer({ wx: 1, wy: 43, wz: 0 }, playerPos)).toBe(false);
  });

  it('triggers onFallDamage after a 7-block fall onto dry land', () => {
    const blocks = [];
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        blocks.push([x, 42, z, BLOCK.STONE]);
      }
    }
    const world = makeWorld(blocks);
    const player = createPlayerState({ x: 0.5, y: 50, z: 0.5 });
    const onFallDamage = vi.fn();

    for (let i = 0; i < 40; i++) {
      stepPlayerPhysics(player, {}, 0.05, world.getBlockAt, { onFallDamage });
    }

    expect(player.onGround).toBe(true);
    expect(player.position.y).toBeCloseTo(43, 5);
    expect(onFallDamage).toHaveBeenCalledTimes(1);
    expect(onFallDamage.mock.calls[0][0]).toBeGreaterThanOrEqual(3);
  });

  it('supports water swimming and creative flight without fall damage', () => {
    const blocks = [[0, 42, 0, BLOCK.STONE], [0, 43, 0, BLOCK.WATER], [0, 44, 0, BLOCK.WATER]];
    const world = makeWorld(blocks);
    const player = createPlayerState({ x: 0.5, y: 50, z: 0.5 });
    const onFallDamage = vi.fn();

    for (let i = 0; i < 30; i++) {
      stepPlayerPhysics(player, {}, 0.05, world.getBlockAt, { onFallDamage });
    }
    expect(player.inWater).toBe(true);
    expect(onFallDamage).not.toHaveBeenCalled();

    player.flying = true;
    const beforeY = player.position.y;
    stepPlayerPhysics(player, { jump: true }, 0.05, world.getBlockAt);
    expect(player.position.y).toBeGreaterThan(beforeY);
  });

  it('emits onStep after walking 1.7 blocks on ground', () => {
    const blocks = [];
    for (let z = -6; z <= 2; z++) {
      blocks.push([0, 42, z, BLOCK.GRASS]);
    }
    const world = makeWorld(blocks);
    const player = createPlayerState({ x: 0.5, y: 43, z: 1.5 });
    player.onGround = true;
    const onStep = vi.fn();

    for (let i = 0; i < 20; i++) {
      stepPlayerPhysics(player, { forward: true }, 0.05, world.getBlockAt, { onStep });
    }

    expect(onStep).toHaveBeenCalled();
    expect(onStep).toHaveBeenCalledWith('grass');
  });
});

describe('MobManager', () => {
  it('clears hostile mobs on peaceful difficulty while keeping passive mobs', () => {
    const world = makeWorld([[0, 42, 0, BLOCK.GRASS]]);
    const manager = new MobManager(null, world);

    manager.spawnMob(MOB_TYPE.SHEEP, 0.5, 43, 0.5);
    manager.spawnMob(MOB_TYPE.ZOMBIE, 3.5, 43, 0.5);
    manager.spawnMob(MOB_TYPE.CREEPER, -3.5, 43, 0.5);
    expect(manager.mobs).toHaveLength(3);

    manager.update(0.05, { x: 0.5, y: 43, z: 0.5 }, true, 'peaceful', {});
    expect(manager.mobs).toHaveLength(1);
    expect(manager.mobs[0].type).toBe(MOB_TYPE.SHEEP);

    manager.disposeAll();
  });

  it('damages mob, despawns on hp <= 0, and emits loot drops', () => {
    const world = makeWorld([[0, 42, 0, BLOCK.GRASS]]);
    const manager = new MobManager(null, world);
    const sheep = manager.spawnMob(MOB_TYPE.SHEEP, 0.5, 43, 0.5);

    const onDrop = vi.fn();
    manager.damageMob(sheep.id, 4, { x: 1, z: 0 }, onDrop);
    expect(sheep.hp).toBe(4);
    expect(onDrop).not.toHaveBeenCalled();
    expect(manager.mobs).toHaveLength(1);

    manager.damageMob(sheep.id, 5, { x: 1, z: 0 }, onDrop);
    expect(manager.mobs).toHaveLength(0);
    expect(onDrop).toHaveBeenCalledTimes(2);
    expect(onDrop.mock.calls[0][0]).toBe(BLOCK.WOOL_WHITE);
    expect(onDrop.mock.calls[1][0]).toBe(ITEM.RAW_MEAT);

    manager.disposeAll();
  });

  it('raycasts mob bounding boxes accurately', () => {
    const world = makeWorld([[0, 42, 0, BLOCK.GRASS]]);
    const manager = new MobManager(null, world);
    const cow = manager.spawnMob(MOB_TYPE.COW, 0.5, 43, 4.5);

    const hit = manager.raycastMob({ x: 0.5, y: 43.8, z: 0.5 }, { x: 0, y: 0, z: 1 }, 6);
    expect(hit).not.toBeNull();
    expect(hit.mob.id).toBe(cow.id);

    const miss = manager.raycastMob({ x: 0.5, y: 43.8, z: 0.5 }, { x: 0, y: 0, z: 1 }, 2);
    expect(miss).toBeNull();

    manager.disposeAll();
  });

  it('triggers Creeper fuse explosion and Zombie melee damage', () => {
    const blocks = [];
    for (let x = -4; x <= 4; x++) {
      for (let z = -4; z <= 4; z++) {
        blocks.push([x, 42, z, BLOCK.GRASS]);
      }
    }
    const world = makeWorld(blocks);
    const manager = new MobManager(null, world);

    manager.spawnMob(MOB_TYPE.CREEPER, 0.5, 43, 2.0);
    const onExplode = vi.fn();
    for (let i = 0; i < 35; i++) {
      manager.update(0.05, { x: 0.5, y: 43, z: 0.5 }, false, 'normal', { onExplode });
    }
    expect(onExplode).toHaveBeenCalledTimes(1);
    expect(onExplode.mock.calls[0][3]).toBeCloseTo(2.8, 4);
    expect(manager.mobs.filter((m) => m.type === MOB_TYPE.CREEPER)).toHaveLength(0);

    manager.spawnMob(MOB_TYPE.ZOMBIE, 0.5, 43, 1.5);
    const onPlayerDamage = vi.fn();
    manager.update(0.05, { x: 0.5, y: 43, z: 0.5 }, false, 'normal', { onPlayerDamage });
    expect(onPlayerDamage).toHaveBeenCalledTimes(1);

    manager.disposeAll();
  });
});

describe('EntityManager', () => {
  it('triggers TNT explosion callback after >= 3.0s and preserves Bedrock/Obsidian', () => {
    const world = makeWorld([
      [0, 42, 0, BLOCK.STONE],
      [1, 42, 0, BLOCK.BEDROCK],
      [-1, 42, 0, BLOCK.OBSIDIAN],
    ]);
    const entities = new EntityManager(null, world);
    entities.spawnPrimedTnt(0, 43, 0);

    const onExplode = vi.fn();
    for (let i = 0; i < 58; i++) {
      entities.update(0.05, { x: 20, y: 43, z: 20 }, { onExplode });
    }
    expect(onExplode).not.toHaveBeenCalled();

    entities.update(0.2, { x: 20, y: 43, z: 20 }, { onExplode });
    expect(onExplode).toHaveBeenCalledTimes(1);
    const [, , , radius] = onExplode.mock.calls[0];
    expect(radius).toBeCloseTo(3.2, 4);

    // Stone destroyed while Bedrock and Obsidian stay intact
    expect(world.getBlockAt(0, 42, 0)).toBe(BLOCK.AIR);
    expect(world.getBlockAt(1, 42, 0)).toBe(BLOCK.BEDROCK);
    expect(world.getBlockAt(-1, 42, 0)).toBe(BLOCK.OBSIDIAN);

    const blastCheck = collectExplosionBlocks(0.5, 43, 0.5, 3.2, world.getBlockAt);
    expect(blastCheck.some((b) => b.blockId === BLOCK.BEDROCK || b.blockId === BLOCK.OBSIDIAN)).toBe(false);

    entities.disposeAll();
  });

  it('magnetizes and picks up nearby dropped items', () => {
    const world = makeWorld([[0, 42, 0, BLOCK.STONE]]);
    const entities = new EntityManager(null, world);
    entities.spawnDrop(ITEM.DIAMOND, 2, { x: 0.5, y: 43.2, z: 2.0 }, { x: 0, y: 0, z: 0 });

    const onPickup = vi.fn();
    for (let i = 0; i < 20; i++) {
      entities.update(0.05, { x: 0.5, y: 43, z: 0.5 }, { onPickup });
    }

    expect(onPickup).toHaveBeenCalledWith(ITEM.DIAMOND, 2);
    expect(entities.drops).toHaveLength(0);

    entities.disposeAll();
  });
});

describe('SoundEngine', () => {
  it('safely no-ops in headless Node without AudioContext', () => {
    const sound = new SoundEngine({ volume: 0.5 });
    expect(() => {
      sound.setVolume(0.8);
      sound.setMuted(true);
      sound.setMuted(false);
      sound.playStep('grass');
      sound.playMineHit('stone');
      sound.playBreak('wood');
      sound.playPlace('sand');
      sound.playPickup();
      sound.playExplosion();
      sound.playHurt();
      sound.playClick();
      sound.playFuse();
      sound.dispose();
    }).not.toThrow();
  });
});
