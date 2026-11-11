import { describe, it, expect } from 'vitest';
import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  CHUNK_AREA,
  CHUNK_VOLUME,
  SEA_LEVEL,
  MAX_LIGHT,
} from '../src/core/constants.js';
import { voxelIndex, worldToChunk, worldToLocal } from '../src/core/coords.js';
import { BLOCK, isBlockSolid } from '../src/core/blocks.js';

import {
  hashString,
  mulberry32,
  hash2D,
  hash3D,
  SimplexNoise,
} from '../src/world/noise.js';
import {
  BIOME,
  BIOME_DEFS,
  sampleBiome,
} from '../src/world/biomes.js';
import { WorldGenerator } from '../src/world/terrain.js';
import {
  getSkyLight,
  setSkyLight,
  getBlockLight,
  setBlockLight,
  computeChunkLighting,
} from '../src/world/lighting.js';

describe('world/noise', () => {
  it('hashString produces deterministic unsigned 32-bit integers', () => {
    const a1 = hashString('craftscape-2026');
    const a2 = hashString('craftscape-2026');
    const b = hashString('craftscape-2027');
    const empty = hashString('');

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(Number.isInteger(a1)).toBe(true);
    expect(a1).toBeGreaterThanOrEqual(0);
    expect(a1).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(empty)).toBe(true);
    expect(empty).toBeGreaterThanOrEqual(0);
  });

  it('mulberry32 yields deterministic [0, 1) sequences per seed', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    const rng3 = mulberry32(99);

    const seq1 = Array.from({ length: 16 }, () => rng1());
    const seq2 = Array.from({ length: 16 }, () => rng2());
    const seq3 = Array.from({ length: 16 }, () => rng3());

    expect(seq1).toEqual(seq2);
    expect(seq1).not.toEqual(seq3);
    for (const v of seq1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hash2D and hash3D are deterministic and handle negative coordinates in [0, 1)', () => {
    expect(hash2D(123, -17, 44)).toBe(hash2D(123, -17, 44));
    expect(hash2D(123, -17, 44)).not.toBe(hash2D(123, -16, 44));
    expect(hash3D(123, -5, 64, -9)).toBe(hash3D(123, -5, 64, -9));
    expect(hash3D(123, -5, 64, -9)).not.toBe(hash3D(123, -5, 65, -9));

    for (let i = -20; i <= 20; i++) {
      const h2 = hash2D('seed', i, -i * 3);
      const h3 = hash3D('seed', i, i + 10, -i * 2);
      expect(h2).toBeGreaterThanOrEqual(0);
      expect(h2).toBeLessThan(1);
      expect(h3).toBeGreaterThanOrEqual(0);
      expect(h3).toBeLessThan(1);
    }
  });

  it('SimplexNoise supports string and numeric seeds and outputs bounded continuous noise', () => {
    const nA1 = new SimplexNoise('craftscape-seed');
    const nA2 = new SimplexNoise('craftscape-seed');
    const nB = new SimplexNoise(123456);

    for (let i = -25; i < 25; i++) {
      const x = i * 0.37;
      const y = i * 0.21;
      const z = -i * 0.43;

      const v2 = nA1.noise2D(x, z);
      expect(v2).toBe(nA2.noise2D(x, z));
      expect(v2).toBeGreaterThanOrEqual(-1);
      expect(v2).toBeLessThanOrEqual(1);

      const v3 = nA1.noise3D(x, y, z);
      expect(v3).toBe(nA2.noise3D(x, y, z));
      expect(v3).toBeGreaterThanOrEqual(-1);
      expect(v3).toBeLessThanOrEqual(1);

      const f2 = nA1.fbm2D(x, z, 4, 2.0, 0.5);
      expect(f2).toBe(nA2.fbm2D(x, z, 4, 2.0, 0.5));
      expect(f2).toBeGreaterThanOrEqual(-1);
      expect(f2).toBeLessThanOrEqual(1);

      const f3 = nA1.fbm3D(x, y, z, 3, 2.0, 0.5);
      expect(f3).toBe(nA2.fbm3D(x, y, z, 3, 2.0, 0.5));
      expect(f3).toBeGreaterThanOrEqual(-1);
      expect(f3).toBeLessThanOrEqual(1);
    }

    expect(nA1.noise2D(12.34, 56.78)).not.toBe(nB.noise2D(12.34, 56.78));
    // Continuity check
    expect(Math.abs(nA1.noise2D(10.0, 10.0) - nA1.noise2D(10.01, 10.01))).toBeLessThan(0.05);
  });
});

describe('world/biomes', () => {
  it('defines all 5 biomes with complete metadata', () => {
    const ids = Object.values(BIOME);
    expect(ids).toHaveLength(5);
    expect(ids).toEqual(
      expect.arrayContaining(['plains', 'forest', 'desert', 'snowy_peaks', 'lush_valley']),
    );

    for (const id of ids) {
      const def = BIOME_DEFS[id];
      expect(def).toBeDefined();
      expect(def.id).toBe(id);
      expect(typeof def.name).toBe('string');
      expect(typeof def.topBlock).toBe('number');
      expect(typeof def.subBlock).toBe('number');
      expect(typeof def.baseHeight).toBe('number');
      expect(typeof def.heightScale).toBe('number');
      expect(typeof def.treeChance).toBe('number');
      expect(def.grassColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('sampleBiome is deterministic and covers all 5 biomes across world coordinates', () => {
    const tempNoise = new SimplexNoise('temp-seed');
    const moistNoise = new SimplexNoise('moist-seed');
    const ridgeNoise = new SimplexNoise('ridge-seed');

    const s1 = sampleBiome(128, -256, tempNoise, moistNoise, ridgeNoise);
    const s2 = sampleBiome(128, -256, tempNoise, moistNoise, ridgeNoise);
    expect(s1).toEqual(s2);
    expect(s1.def).toBe(BIOME_DEFS[s1.id]);
    expect(s1.temperature).toBeGreaterThanOrEqual(0);
    expect(s1.temperature).toBeLessThanOrEqual(1);
    expect(s1.moisture).toBeGreaterThanOrEqual(0);
    expect(s1.moisture).toBeLessThanOrEqual(1);
    expect(s1.ridge).toBeGreaterThanOrEqual(0);
    expect(s1.ridge).toBeLessThanOrEqual(1);

    const seen = new Set();
    for (let x = -1200; x <= 1200; x += 32) {
      for (let z = -1200; z <= 1200; z += 32) {
        const res = sampleBiome(x, z, tempNoise, moistNoise, ridgeNoise);
        seen.add(res.id);
      }
    }

    for (const biomeId of Object.values(BIOME)) {
      expect(seen.has(biomeId)).toBe(true);
    }
  });
});

describe('world/terrain', () => {
  it('generates deterministic chunks with canonical shapes and bedrock at y=0', () => {
    const genA = new WorldGenerator('craftscape-2026');
    const genB = new WorldGenerator('craftscape-2026');
    const genC = new WorldGenerator('different-seed');

    const chunkA = genA.generateChunk(0, 0);
    const chunkB = genB.generateChunk(0, 0);
    const chunkC = genC.generateChunk(0, 0);

    expect(chunkA.cx).toBe(0);
    expect(chunkA.cz).toBe(0);
    expect(chunkA.blocks).toBeInstanceOf(Uint8Array);
    expect(chunkA.blocks.length).toBe(CHUNK_VOLUME);
    expect(chunkA.light).toBeInstanceOf(Uint8Array);
    expect(chunkA.light.length).toBe(CHUNK_VOLUME);
    expect(chunkA.heightMap).toBeInstanceOf(Uint8Array);
    expect(chunkA.heightMap.length).toBe(CHUNK_AREA);
    expect(Array.isArray(chunkA.biomeMap)).toBe(true);
    expect(chunkA.biomeMap.length).toBe(CHUNK_AREA);
    expect(chunkA.dirtyMesh).toBe(true);
    expect(chunkA.dirtyLight).toBe(true);

    expect(chunkA.blocks).toEqual(chunkB.blocks);
    expect(chunkA.heightMap).toEqual(chunkB.heightMap);
    expect(chunkA.biomeMap).toEqual(chunkB.biomeMap);
    expect(chunkA.blocks).not.toEqual(chunkC.blocks);

    // Generating intervening chunks does not pollute reusable internal scratch state
    genA.generateChunk(4, -5);
    expect(genA.generateChunk(0, 0).blocks).toEqual(chunkA.blocks);

    // Check bedrock across positive and negative chunks
    for (const [cx, cz] of [[0, 0], [-2, 3], [5, -4]]) {
      const ch = genA.generateChunk(cx, cz);
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          expect(ch.blocks[voxelIndex(lx, 0, lz)]).toBe(BLOCK.BEDROCK);
        }
      }
    }
  });

  it('provides accurate getTerrainInfo matching chunk biome data', () => {
    const gen = new WorldGenerator('terrain-info-seed');
    const info = gen.getTerrainInfo(-12, 23);

    expect(Object.values(BIOME)).toContain(info.biome);
    expect(info.height).toBeGreaterThanOrEqual(1);
    expect(info.height).toBeLessThan(CHUNK_HEIGHT);
    expect(info.temperature).toBeGreaterThanOrEqual(0);
    expect(info.temperature).toBeLessThanOrEqual(1);
    expect(info.moisture).toBeGreaterThanOrEqual(0);
    expect(info.moisture).toBeLessThanOrEqual(1);
    expect(typeof info.surfaceBlock).toBe('number');

    const { cx, cz } = worldToChunk(-12, 23);
    const { lx, lz } = worldToLocal(-12, info.height, 23);
    const chunk = gen.generateChunk(cx, cz);
    expect(chunk.biomeMap[lz * CHUNK_SIZE + lx]).toBe(info.biome);
  });

  it('generates water at SEA_LEVEL, underground caves, ores in valid Y ranges, and surface flora', () => {
    const gen = new WorldGenerator('craftscape-2026');
    let waterCount = 0;
    let lavaCount = 0;
    let caveAirCount = 0;
    let coalCount = 0;
    let ironCount = 0;
    let goldCount = 0;
    let redstoneCount = 0;
    let diamondCount = 0;
    let emeraldCount = 0;
    let treeLogCount = 0;
    let cactusCount = 0;
    let floraCount = 0;

    // Sample a broad grid of chunks to traverse all biomes and features
    for (let cx = -12; cx <= 12; cx += 3) {
      for (let cz = -12; cz <= 12; cz += 3) {
        const chunk = gen.generateChunk(cx, cz);
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const surfY = chunk.heightMap[lz * CHUNK_SIZE + lx];
            for (let ly = 1; ly < CHUNK_HEIGHT; ly++) {
              const id = chunk.blocks[voxelIndex(lx, ly, lz)];
              if (id === BLOCK.WATER && ly <= SEA_LEVEL) waterCount++;
              if (id === BLOCK.LAVA) {
                expect(ly).toBeLessThanOrEqual(8);
                lavaCount++;
              }
              if (id === BLOCK.AIR && ly < surfY - 2) caveAirCount++;
              if (id === BLOCK.COAL_ORE) {
                expect(ly).toBeGreaterThanOrEqual(8);
                expect(ly).toBeLessThanOrEqual(70);
                coalCount++;
              }
              if (id === BLOCK.IRON_ORE) {
                expect(ly).toBeGreaterThanOrEqual(5);
                expect(ly).toBeLessThanOrEqual(56);
                ironCount++;
              }
              if (id === BLOCK.GOLD_ORE) {
                expect(ly).toBeGreaterThanOrEqual(4);
                expect(ly).toBeLessThanOrEqual(28);
                goldCount++;
              }
              if (id === BLOCK.REDSTONE_ORE) {
                expect(ly).toBeGreaterThanOrEqual(4);
                expect(ly).toBeLessThanOrEqual(20);
                redstoneCount++;
              }
              if (id === BLOCK.DIAMOND_ORE) {
                expect(ly).toBeGreaterThanOrEqual(3);
                expect(ly).toBeLessThanOrEqual(16);
                diamondCount++;
              }
              if (id === BLOCK.EMERALD_ORE) {
                expect(ly).toBeGreaterThanOrEqual(4);
                expect(ly).toBeLessThanOrEqual(30);
                expect(chunk.biomeMap[lz * CHUNK_SIZE + lx]).toBe(BIOME.SNOWY_PEAKS);
                emeraldCount++;
              }
              if (
                id === BLOCK.OAK_LOG ||
                id === BLOCK.BIRCH_LOG ||
                id === BLOCK.SPRUCE_LOG
              ) {
                treeLogCount++;
              }
              if (id === BLOCK.CACTUS) cactusCount++;
              if (
                id === BLOCK.TALL_GRASS ||
                id === BLOCK.POPPY ||
                id === BLOCK.DANDELION
              ) {
                floraCount++;
              }
            }
          }
        }
      }
    }

    expect(waterCount).toBeGreaterThan(0);
    expect(lavaCount).toBeGreaterThan(0);
    expect(caveAirCount).toBeGreaterThan(0);
    expect(coalCount).toBeGreaterThan(0);
    expect(ironCount).toBeGreaterThan(0);
    expect(goldCount).toBeGreaterThan(0);
    expect(redstoneCount).toBeGreaterThan(0);
    expect(diamondCount).toBeGreaterThan(0);
    expect(emeraldCount).toBeGreaterThan(0);
    expect(treeLogCount).toBeGreaterThan(0);
    expect(cactusCount).toBeGreaterThan(0);
    expect(floraCount).toBeGreaterThan(0);
  });

  it('generates seam-free trees whose canopies continue cleanly across chunk borders', () => {
    const gen = new WorldGenerator('craftscape-2026');
    let borderTreeVerified = false;

    const isLeaf = (id) =>
      id === BLOCK.OAK_LEAVES || id === BLOCK.BIRCH_LEAVES || id === BLOCK.SPRUCE_LEAVES;
    const isLog = (id) =>
      id === BLOCK.OAK_LOG || id === BLOCK.BIRCH_LOG || id === BLOCK.SPRUCE_LOG;

    for (let cx = -6; cx <= 6 && !borderTreeVerified; cx++) {
      for (let cz = -6; cz <= 6 && !borderTreeVerified; cz++) {
        const chunk = gen.generateChunk(cx, cz);
        // Check right border lx === 15 for any tree trunk
        for (let lz = 2; lz < CHUNK_SIZE - 2 && !borderTreeVerified; lz++) {
          for (let ly = SEA_LEVEL + 2; ly < CHUNK_HEIGHT - 12; ly++) {
            const id = chunk.blocks[voxelIndex(15, ly, lz)];
            if (isLog(id)) {
              const eastChunk = gen.generateChunk(cx + 1, cz);
              // Canopy at trunk top/mid should spill onto lx === 0 of eastChunk
              let eastLeaves = 0;
              for (let cy = ly; cy <= ly + 8; cy++) {
                if (isLeaf(eastChunk.blocks[voxelIndex(0, cy, lz)])) {
                  eastLeaves++;
                }
              }
              if (eastLeaves > 0) {
                borderTreeVerified = true;
                break;
              }
            }
          }
        }
      }
    }

    expect(borderTreeVerified).toBe(true);
  });

  it('findSafeSpawn locates dry solid ground with 2-block headroom', () => {
    const gen = new WorldGenerator('craftscape-2026');

    for (const [sx, sz] of [[0, 0], [180, -240], [-320, 410]]) {
      const spawn = gen.findSafeSpawn(sx, sz);
      expect(Number.isInteger(spawn.x)).toBe(true);
      expect(Number.isInteger(spawn.y)).toBe(true);
      expect(Number.isInteger(spawn.z)).toBe(true);
      expect(Object.values(BIOME)).toContain(spawn.biome);
      expect(spawn.y).toBeGreaterThanOrEqual(SEA_LEVEL + 2);

      const { cx, cz } = worldToChunk(spawn.x, spawn.z);
      const { lx, lz } = worldToLocal(spawn.x, spawn.y, spawn.z);
      const chunk = gen.generateChunk(cx, cz);

      const floorBlock = chunk.blocks[voxelIndex(lx, spawn.y - 1, lz)];
      const feetBlock = chunk.blocks[voxelIndex(lx, spawn.y, lz)];
      const headBlock = chunk.blocks[voxelIndex(lx, spawn.y + 1, lz)];

      expect(isBlockSolid(floorBlock)).toBe(true);
      expect(floorBlock).not.toBe(BLOCK.CACTUS);
      expect(isBlockSolid(feetBlock)).toBe(false);
      expect(feetBlock).not.toBe(BLOCK.WATER);
      expect(feetBlock).not.toBe(BLOCK.LAVA);
      expect(isBlockSolid(headBlock)).toBe(false);
    }
  });
});

describe('world/lighting', () => {
  it('packs and unpacks skyLight (high nibble) and blockLight (low nibble) independently', () => {
    const light = new Uint8Array(8);
    setSkyLight(light, 3, 12);
    setBlockLight(light, 3, 9);

    expect(getSkyLight(light, 3)).toBe(12);
    expect(getBlockLight(light, 3)).toBe(9);

    setSkyLight(light, 3, 20); // clamps to 15
    expect(getSkyLight(light, 3)).toBe(MAX_LIGHT);
    expect(getBlockLight(light, 3)).toBe(9);

    setBlockLight(light, 3, -3); // clamps to 0
    expect(getSkyLight(light, 3)).toBe(MAX_LIGHT);
    expect(getBlockLight(light, 3)).toBe(0);
  });

  it('attenuates skylight through leaves/water, blocks under roofs, and floods laterally into overhangs', () => {
    const chunk = {
      cx: 0,
      cz: 0,
      blocks: new Uint8Array(CHUNK_VOLUME),
      light: new Uint8Array(CHUNK_VOLUME),
      dirtyLight: true,
    };

    // Floor at y = 10
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        chunk.blocks[voxelIndex(x, 10, z)] = BLOCK.STONE;
      }
    }

    // Leaf canopy 3x3x3 centered at (2, 16..18, 2)
    for (let y = 16; y <= 18; y++) {
      for (let z = 1; z <= 3; z++) {
        for (let x = 1; x <= 3; x++) {
          chunk.blocks[voxelIndex(x, y, z)] = BLOCK.OAK_LEAVES;
        }
      }
    }

    // Ice + 2 Water layers in a 3x3 basin at (2, 11..13, 12)
    for (let z = 11; z <= 13; z++) {
      for (let x = 1; x <= 3; x++) {
        chunk.blocks[voxelIndex(x, 13, z)] = BLOCK.ICE;
        chunk.blocks[voxelIndex(x, 12, z)] = BLOCK.WATER;
        chunk.blocks[voxelIndex(x, 11, z)] = BLOCK.WATER;
      }
    }

    // Solid opaque roof over x=4..14, z=4..14 at y=16
    for (let z = 4; z <= 14; z++) {
      for (let x = 4; x <= 14; x++) {
        chunk.blocks[voxelIndex(x, 16, z)] = BLOCK.STONE;
      }
    }

    computeChunkLighting(chunk);
    expect(chunk.dirtyLight).toBe(false);

    // Open sky column
    expect(getSkyLight(chunk.light, voxelIndex(0, 127, 0))).toBe(15);
    expect(getSkyLight(chunk.light, voxelIndex(0, 11, 0))).toBe(15);

    // Leaf attenuation: 15 -> 14 -> 13 -> 12 through 3 leaf layers at canopy center
    expect(getSkyLight(chunk.light, voxelIndex(2, 19, 2))).toBe(15);
    expect(getSkyLight(chunk.light, voxelIndex(2, 18, 2))).toBe(14);
    expect(getSkyLight(chunk.light, voxelIndex(2, 17, 2))).toBe(13);
    expect(getSkyLight(chunk.light, voxelIndex(2, 16, 2))).toBe(12);

    // Ice + water attenuation: 15 -> 14 -> 13 -> 12
    expect(getSkyLight(chunk.light, voxelIndex(2, 13, 12))).toBe(14);
    expect(getSkyLight(chunk.light, voxelIndex(2, 12, 12))).toBe(13);
    expect(getSkyLight(chunk.light, voxelIndex(2, 11, 12))).toBe(12);

    // Roof blocks direct sky, lateral flood spreads from open column x=3 into x=4, x=5, ...
    expect(getSkyLight(chunk.light, voxelIndex(4, 15, 9))).toBe(14);
    expect(getSkyLight(chunk.light, voxelIndex(5, 15, 9))).toBe(13);
    expect(getSkyLight(chunk.light, voxelIndex(6, 15, 9))).toBe(12);
    // Solid opaque block itself stays 0
    expect(getSkyLight(chunk.light, voxelIndex(9, 16, 9))).toBe(0);
  });

  it('propagates blocklight from Torch (14) and Glowstone (15) with decay and opaque occlusion', () => {
    const createDarkRoomChunk = (cx = 0, cz = 0) => {
      const chunk = {
        cx,
        cz,
        blocks: new Uint8Array(CHUNK_VOLUME),
        light: new Uint8Array(CHUNK_VOLUME),
        dirtyLight: true,
      };
      // Seal entire chunk ceiling at y = 20 with stone so sky light stays 0 below
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          chunk.blocks[voxelIndex(x, 20, z)] = BLOCK.STONE;
        }
      }
      return chunk;
    };

    const chunk = createDarkRoomChunk();
    // Place an opaque wall dividing x <= 7 and x >= 9 at x = 8, y = 0..19
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 0; y < 20; y++) {
        chunk.blocks[voxelIndex(8, y, z)] = BLOCK.STONE;
      }
    }

    // Place a Torch at (4, 10, 8) -> lightLevel 14
    chunk.blocks[voxelIndex(4, 10, 8)] = BLOCK.TORCH;
    // Place Glowstone at (12, 10, 8) -> lightLevel 15
    chunk.blocks[voxelIndex(12, 10, 8)] = BLOCK.GLOWSTONE;

    computeChunkLighting(chunk);

    // Torch propagation & decay
    expect(getBlockLight(chunk.light, voxelIndex(4, 10, 8))).toBe(14);
    expect(getBlockLight(chunk.light, voxelIndex(5, 10, 8))).toBe(13);
    expect(getBlockLight(chunk.light, voxelIndex(6, 10, 8))).toBe(12);
    expect(getBlockLight(chunk.light, voxelIndex(7, 10, 8))).toBe(11);
    expect(getBlockLight(chunk.light, voxelIndex(4, 10, 12))).toBe(10);
    // Wall stays 0
    expect(getBlockLight(chunk.light, voxelIndex(8, 10, 8))).toBe(0);

    // Glowstone propagation & decay on other side of wall
    expect(getBlockLight(chunk.light, voxelIndex(12, 10, 8))).toBe(15);
    expect(getBlockLight(chunk.light, voxelIndex(11, 10, 8))).toBe(14);
    expect(getBlockLight(chunk.light, voxelIndex(10, 10, 8))).toBe(13);
    expect(getBlockLight(chunk.light, voxelIndex(9, 10, 8))).toBe(12);

    // Lava (14) and Redstone Ore (4) emission checks in separate isolated dark rooms
    const lavaChunk = createDarkRoomChunk();
    lavaChunk.blocks[voxelIndex(3, 5, 5)] = BLOCK.LAVA;
    computeChunkLighting(lavaChunk);
    expect(getBlockLight(lavaChunk.light, voxelIndex(3, 5, 5))).toBe(14);
    expect(getBlockLight(lavaChunk.light, voxelIndex(4, 5, 5))).toBe(13);

    const redstoneChunk = createDarkRoomChunk();
    redstoneChunk.blocks[voxelIndex(12, 5, 5)] = BLOCK.REDSTONE_ORE;
    computeChunkLighting(redstoneChunk);
    expect(getBlockLight(redstoneChunk.light, voxelIndex(12, 5, 5))).toBe(4);
    expect(getBlockLight(redstoneChunk.light, voxelIndex(11, 5, 5))).toBe(3);
  });

  it('samples neighbor border light cleanly when getNeighborChunk is provided', () => {
    const makeChunk = (cx, cz, sealed = true) => {
      const c = {
        cx,
        cz,
        blocks: new Uint8Array(CHUNK_VOLUME),
        light: new Uint8Array(CHUNK_VOLUME),
        dirtyLight: true,
      };
      if (sealed) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            c.blocks[voxelIndex(x, 20, z)] = BLOCK.STONE;
          }
        }
      }
      return c;
    };

    const west = makeChunk(-1, 0, true);
    west.blocks[voxelIndex(15, 10, 8)] = BLOCK.TORCH;
    computeChunkLighting(west);

    const center = makeChunk(0, 0, true);
    const getNeighbor = (ncx, ncz) => (ncx === -1 && ncz === 0 ? west : null);
    computeChunkLighting(center, getNeighbor);

    expect(getBlockLight(center.light, voxelIndex(0, 10, 8))).toBe(13);
    expect(getBlockLight(center.light, voxelIndex(1, 10, 8))).toBe(12);
    expect(getBlockLight(center.light, voxelIndex(2, 10, 8))).toBe(11);

    // Neighbor skylight flooding into roofed chunk
    const openNorth = makeChunk(0, -1, false);
    computeChunkLighting(openNorth);
    const roofed = makeChunk(0, 0, true);
    computeChunkLighting(roofed, (ncx, ncz) => (ncx === 0 && ncz === -1 ? openNorth : null));

    expect(getSkyLight(roofed.light, voxelIndex(8, 10, 0))).toBe(14);
    expect(getSkyLight(roofed.light, voxelIndex(8, 10, 1))).toBe(13);
    expect(getSkyLight(roofed.light, voxelIndex(8, 10, 2))).toBe(12);
  });
});
