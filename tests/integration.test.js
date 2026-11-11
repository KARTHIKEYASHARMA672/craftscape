import { describe, it, expect, vi } from 'vitest';
import { DIFFICULTIES, GAME_MODES, PLAYER_CONSTANTS } from '../src/core/constants.js';
import { BLOCK } from '../src/core/blocks.js';
import { ITEM } from '../src/core/items.js';
import { WorldEngine } from '../src/engine/WorldEngine.js';
import { matchCraftingRecipe } from '../src/systems/recipes.js';
import { FURNACE_COOK_TIME, InventorySystem } from '../src/systems/inventory.js';
import { WorldStorage } from '../src/systems/storage.js';
import { executeSlashCommand } from '../src/systems/commands.js';
import { raycastVoxels } from '../src/gameplay/raycast.js';
import { createPlayerState, stepPlayerPhysics, wouldPlaceOverlapPlayer } from '../src/gameplay/physics.js';
import { EntityManager } from '../src/gameplay/entities.js';
import { MOB_TYPE, MobManager } from '../src/gameplay/mobs.js';

describe('CraftScape End-to-End Integration', () => {
  it('preloads chunks, updates cave lighting when placing a Torch, and persists deltas through WorldStorage', async () => {
    const worldA = new WorldEngine({ seed: 'integration-seed-1', renderDistance: 3 });
    worldA.preloadRadius(0, 0, 1);

    expect(worldA.getLoadedChunkCount()).toBeGreaterThanOrEqual(5);
    const spawn = worldA.findSafeSpawn(0, 0);
    expect(spawn.y).toBeGreaterThan(20);

    // Seal a completely dark 5x5x5 stone bunker underground and place a torch inside
    const bx = 4;
    const by = 16;
    const bz = 4;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const isShell = Math.abs(dx) === 2 || Math.abs(dy) === 2 || Math.abs(dz) === 2;
          worldA.setBlockAt(bx + dx, by + dy, bz + dz, isShell ? BLOCK.STONE : BLOCK.AIR, {
            immediateRebuild: false,
          });
        }
      }
    }
    worldA.flushRebuilds();

    const darkLight = worldA.getLightAt(bx, by, bz);
    expect(darkLight.sky).toBe(0);
    expect(darkLight.block).toBe(0);

    // Place a Torch inside and verify warm block light propagates without sky leakage
    worldA.setBlockAt(bx, by, bz, BLOCK.TORCH, { immediateRebuild: true });
    const litCenter = worldA.getLightAt(bx, by, bz);
    const litAdjacent = worldA.getLightAt(bx + 1, by, bz);
    expect(litCenter.block).toBe(14);
    expect(litAdjacent.block).toBe(13);
    expect(litAdjacent.sky).toBe(0);

    // Craft Planks + Furnace, smelt Iron Ore, store in Chest, and save via WorldStorage
    const inv = new InventorySystem();
    inv.giveStarterKit(GAME_MODES.SURVIVAL);

    const plankCraft = matchCraftingRecipe([{ id: ITEM.OAK_LOG, count: 1 }, null, null, null], 2);
    expect(plankCraft?.result).toEqual({ id: ITEM.OAK_PLANKS, count: 4 });
    inv.addItem(plankCraft.result.id, plankCraft.result.count);

    const furnace = inv.getOrCreateFurnace(`${bx},${by + 1},${bz}`);
    furnace.input = { id: ITEM.IRON_ORE, count: 2 };
    furnace.fuel = { id: ITEM.COAL, count: 1 };
    inv.tickFurnaces(FURNACE_COOK_TIME);
    expect(furnace.output).toEqual({ id: ITEM.IRON_INGOT, count: 1 });

    const chest = inv.getOrCreateChest(`${bx + 1},${by},${bz}`);
    chest[0] = { id: ITEM.DIAMOND, count: 4 };

    const storage = new WorldStorage({ indexedDB: null });
    const savedSummary = await storage.saveWorld({
      name: 'Bunker Save',
      seed: worldA.seed,
      gameMode: GAME_MODES.SURVIVAL,
      difficulty: DIFFICULTIES.NORMAL,
      timeOfDay: 0.92,
      player: { position: { x: bx + 0.5, y: by, z: bz + 0.5 }, yaw: 1.2, pitch: -0.2 },
      inventory: inv.serialize(),
      modifiedBlocks: worldA.exportModifiedBlocks(),
    });

    const loaded = await storage.loadWorld(savedSummary.id);
    expect(loaded).not.toBeNull();
    expect(loaded.modifiedBlocks).toBeInstanceOf(Map);

    // Boot a fresh headless WorldEngine using persisted deltas and verify everything matches
    const worldB = new WorldEngine({
      seed: loaded.seed,
      renderDistance: 3,
      initialDeltas: loaded.modifiedBlocks,
    });
    worldB.preloadRadius(0, 0, 1);

    expect(worldB.getBlockAt(bx, by, bz)).toBe(BLOCK.TORCH);
    expect(worldB.getBlockAt(bx + 2, by + 2, bz + 2)).toBe(BLOCK.STONE);
    expect(worldB.getLightAt(bx, by, bz).block).toBe(14);

    const restoredInv = new InventorySystem().deserialize(loaded.inventory);
    expect(restoredInv.getOrCreateFurnace(`${bx},${by + 1},${bz}`).output).toEqual({
      id: ITEM.IRON_INGOT,
      count: 1,
    });
    expect(restoredInv.getOrCreateChest(`${bx + 1},${by},${bz}`)[0]).toEqual({
      id: ITEM.DIAMOND,
      count: 4,
    });

    worldA.dispose();
    worldB.dispose();
  });

  it('integrates raycast, swept physics, TNT detonation crater, and mob combat cleanly', () => {
    const world = new WorldEngine({ seed: 'gameplay-integration', renderDistance: 3 });
    world.preloadRadius(0, 0, 1);

    // Clear a flat Stone test pad at y = 90 with bedrock shield at y = 87
    for (let x = -4; x <= 6; x++) {
      for (let z = -4; z <= 6; z++) {
        world.setBlockAt(x, 87, z, BLOCK.BEDROCK, { immediateRebuild: false });
        world.setBlockAt(x, 88, z, BLOCK.STONE, { immediateRebuild: false });
        world.setBlockAt(x, 89, z, BLOCK.STONE, { immediateRebuild: false });
        for (let y = 90; y <= 96; y++) {
          world.setBlockAt(x, y, z, BLOCK.AIR, { immediateRebuild: false });
        }
      }
    }
    // Build a target wall at x = 3
    world.setBlockAt(3, 90, 0, BLOCK.COBBLESTONE, { immediateRebuild: false });
    world.setBlockAt(3, 91, 0, BLOCK.COBBLESTONE, { immediateRebuild: false });
    world.flushRebuilds();

    const player = createPlayerState({ x: 0.5, y: 90, z: 0.5 });

    // Confirm player overlap guard prevents placing inside own feet at (0, 90, 0)
    expect(wouldPlaceOverlapPlayer({ wx: 0, wy: 90, wz: 0 }, player.position)).toBe(true);
    expect(wouldPlaceOverlapPlayer({ wx: 3, wy: 90, wz: 0 }, player.position)).toBe(false);

    // Walk toward +X (yaw = -PI/2 looks along +X) until hitting the wall at x = 3
    player.yaw = -Math.PI / 2;
    for (let f = 0; f < 40; f++) {
      stepPlayerPhysics(
        player,
        { forward: true },
        1 / 60,
        (wx, wy, wz) => world.getBlockAt(wx, wy, wz),
      );
    }
    expect(player.onGround).toBe(true);
    expect(player.position.x).toBeLessThanOrEqual(3 - PLAYER_CONSTANTS.HALF_WIDTH + 1e-4);

    // Raycast from player eyes in +X hits the cobblestone wall at x = 3
    const eye = {
      x: player.position.x,
      y: player.position.y + PLAYER_CONSTANTS.EYE_HEIGHT,
      z: player.position.z,
    };
    const hit = raycastVoxels(
      eye,
      { x: 1, y: 0, z: 0 },
      PLAYER_CONSTANTS.REACH_DISTANCE,
      (wx, wy, wz) => world.getBlockAt(wx, wy, wz),
    );
    expect(hit).not.toBeNull();
    expect(hit.wx).toBe(3);
    expect(hit.blockId).toBe(BLOCK.COBBLESTONE);

    // Detonate TNT near (3, 90, 0) and confirm cobblestone breaks while Bedrock at y=87 holds
    const worldAccessor = {
      getBlockAt: (wx, wy, wz) => world.getBlockAt(wx, wy, wz),
      setBlockAt: (wx, wy, wz, id) => world.setBlockAt(wx, wy, wz, id, { immediateRebuild: false }),
    };
    const entities = new EntityManager(null, worldAccessor);
    const onExplode = vi.fn();
    entities.spawnPrimedTnt(2, 90, 0, 0.25);
    entities.update(0.3, player.position, { onExplode });
    world.flushRebuilds();

    expect(onExplode).toHaveBeenCalledTimes(1);
    expect(world.getBlockAt(3, 90, 0)).toBe(BLOCK.AIR);
    expect(world.getBlockAt(3, 87, 0)).toBe(BLOCK.BEDROCK);

    // Spawn a Zombie and Sheep, strike Zombie cleanly until loot drops, then clear hostiles via Peaceful
    const mobs = new MobManager(null, worldAccessor);
    const zombie = mobs.spawnMob(MOB_TYPE.ZOMBIE, 4.5, 90, 0.5);
    mobs.spawnMob(MOB_TYPE.SHEEP, -2.5, 90, -2.5);
    mobs.spawnMob(MOB_TYPE.CREEPER, 5.5, 90, 2.5);

    const mobHit = mobs.raycastMob({ x: 2.5, y: 91.2, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5);
    expect(mobHit?.mob.id).toBe(zombie.id);

    const drops = [];
    for (let i = 0; i < 4; i++) {
      mobs.damageMob(zombie.id, 6, { x: 1, y: 0, z: 0 }, (id, count, pos) =>
        drops.push({ id, count, pos }),
      );
    }
    expect(drops.length).toBeGreaterThanOrEqual(1);

    // Switching to Peaceful despawns remaining hostiles (Creeper) while keeping Sheep
    mobs.update(0.05, player.position, true, DIFFICULTIES.PEACEFUL, {});
    expect(mobs.mobs.every((m) => !m.hostile)).toBe(true);
    expect(mobs.mobs.some((m) => m.type === MOB_TYPE.SHEEP)).toBe(true);

    // Execute slash command integration
    const inv = new InventorySystem();
    let mode = GAME_MODES.SURVIVAL;
    let tod = 0.34;
    executeSlashCommand('/gamemode creative', { setGameMode: (m) => { mode = m; } });
    executeSlashCommand('/time set night', { setTime: (t) => { tod = t; } });
    executeSlashCommand('/give diamond_sword 1', { inventory: inv });
    expect(mode).toBe(GAME_MODES.CREATIVE);
    expect(tod).toBeGreaterThan(0.8);
    expect(inv.countItem(ITEM.DIAMOND_SWORD)).toBe(1);

    entities.disposeAll();
    mobs.disposeAll();
    world.dispose();
  });
});
