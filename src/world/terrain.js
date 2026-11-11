/**
 * Deterministic voxel world generator: multi-biome terrain, 3D caves, ores,
 * water/ice lakes, deep lava pools, seam-free cross-chunk trees, cacti & flora.
 * Pure ES2024 module with zero DOM dependencies.
 */

import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  CHUNK_AREA,
  CHUNK_VOLUME,
  SEA_LEVEL,
} from '../core/constants.js';
import { voxelIndex, worldToChunk, worldToLocal, chunkKey } from '../core/coords.js';
import { BLOCK, isBlockSolid, isBlockLiquid } from '../core/blocks.js';
import { SimplexNoise, hashString, hash2D, hash3D, mulberry32 } from './noise.js';
import { BIOME, BIOME_DEFS, computeBiomeWeights, sampleBiome } from './biomes.js';

const SALT = Object.freeze({
  TEMP: 0x1a2b3c4d,
  MOIST: 0x5e6f7a8b,
  RIDGE: 0x9c0d1e2f,
  HEIGHT: 0x3f4e5d6c,
  DETAIL: 0x7b8a99a8,
  CAVE_A: 0x2468ace0,
  CAVE_B: 0x13579bdf,
  TREE_SCORE: 0x41c64e6d,
  TREE_EXIST: 0x6b2f8d13,
  TREE_TYPE: 0x73a5e195,
  TREE_SHAPE: 0x29d4b7c1,
  CACTUS_SCORE: 0x8f3a21d5,
  CACTUS_EXIST: 0x51c9e42b,
  FLORA: 0xa4f27d89,
});

const ORE_CONFIGS = Object.freeze([
  { id: BLOCK.COAL_ORE, minY: 8, maxY: 70, chance: 0.42, size: 7, salt: 0x1101 },
  { id: BLOCK.IRON_ORE, minY: 5, maxY: 56, chance: 0.28, size: 5, salt: 0x2202 },
  { id: BLOCK.GOLD_ORE, minY: 4, maxY: 28, chance: 0.14, size: 4, salt: 0x3303 },
  { id: BLOCK.REDSTONE_ORE, minY: 4, maxY: 20, chance: 0.16, size: 5, salt: 0x4404 },
  { id: BLOCK.DIAMOND_ORE, minY: 3, maxY: 16, chance: 0.09, size: 3, salt: 0x5505 },
  {
    id: BLOCK.EMERALD_ORE,
    minY: 4,
    maxY: 30,
    chance: 0.18,
    size: 2,
    salt: 0x6606,
    biomeOnly: BIOME.SNOWY_PEAKS,
  },
]);

const BIOME_LIST = Object.values(BIOME);

function trilinear(c000, c100, c010, c110, c001, c101, c011, c111, tx, ty, tz) {
  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

export class WorldGenerator {
  constructor(seed = 'craftscape-2026') {
    this.seed = seed;
    this.seedInt =
      typeof seed === 'number' && Number.isInteger(seed)
        ? seed >>> 0
        : hashString(String(seed));

    this.tempNoise = new SimplexNoise(this.seedInt ^ SALT.TEMP);
    this.moistNoise = new SimplexNoise(this.seedInt ^ SALT.MOIST);
    this.ridgeNoise = new SimplexNoise(this.seedInt ^ SALT.RIDGE);
    this.heightNoise = new SimplexNoise(this.seedInt ^ SALT.HEIGHT);
    this.detailNoise = new SimplexNoise(this.seedInt ^ SALT.DETAIL);
    this.caveNoiseA = new SimplexNoise(this.seedInt ^ SALT.CAVE_A);
    this.caveNoiseB = new SimplexNoise(this.seedInt ^ SALT.CAVE_B);

    // Reusable chunk-generation scratch buffers to avoid per-chunk allocations
    this._surfaceBlocks = new Uint8Array(CHUNK_AREA);
    this._subBlocks = new Uint8Array(CHUNK_AREA);
    this._temperatures = new Float32Array(CHUNK_AREA);
    this._n1Grid = new Float32Array(5 * 5 * 33);
    this._n2Grid = new Float32Array(5 * 5 * 33);
    this._cheeseGrid = new Float32Array(5 * 5 * 10);
  }

  _sampleColumn(wx, wz) {
    const biome = sampleBiome(wx, wz, this.tempNoise, this.moistNoise, this.ridgeNoise);
    const weights = computeBiomeWeights(biome.temperature, biome.moisture, biome.ridge);

    let baseHeight = 0;
    let heightScale = 0;
    for (const id of BIOME_LIST) {
      const w = weights[id];
      const def = BIOME_DEFS[id];
      baseHeight += w * def.baseHeight;
      heightScale += w * def.heightScale;
    }

    const cont = this.heightNoise.fbm2D(wx * 0.0075, wz * 0.0075, 4, 2.0, 0.5);
    const detail = this.detailNoise.fbm2D(wx * 0.032, wz * 0.032, 3, 2.0, 0.5);
    const ridged = 1 - Math.abs(this.ridgeNoise.noise2D(wx * 0.015, wz * 0.015));
    const peakLift = weights[BIOME.SNOWY_PEAKS] * ridged * ridged * 24;

    const riverVal = Math.abs(this.heightNoise.noise2D(wx * 0.011 + 31.7, wz * 0.011 - 17.3));
    const riverMask = Math.max(0, 1 - riverVal / 0.16);
    const valleyFactor =
      weights[BIOME.LUSH_VALLEY] +
      0.55 * weights[BIOME.PLAINS] +
      0.3 * weights[BIOME.FOREST];
    const riverCarve = riverMask * riverMask * valleyFactor * 8.5;

    const rawHeight =
      baseHeight +
      cont * heightScale +
      detail * (2.5 + heightScale * 0.14) +
      peakLift -
      riverCarve;

    const height = Math.max(4, Math.min(CHUNK_HEIGHT - 16, Math.round(rawHeight)));

    let surfaceBlock;
    if (height <= SEA_LEVEL) {
      if (biome.id === BIOME.SNOWY_PEAKS) {
        surfaceBlock = height < SEA_LEVEL ? BLOCK.GRAVEL : BLOCK.SNOW_GRASS;
      } else if (height <= SEA_LEVEL - 3) {
        surfaceBlock =
          detail > 0.25 ? BLOCK.CLAY : detail < -0.25 ? BLOCK.GRAVEL : BLOCK.SAND;
      } else {
        surfaceBlock = detail > 0.3 ? BLOCK.CLAY : BLOCK.SAND;
      }
    } else if (biome.id === BIOME.DESERT) {
      surfaceBlock = BLOCK.SAND;
    } else if (biome.id === BIOME.SNOWY_PEAKS) {
      surfaceBlock = height >= 74 ? BLOCK.SNOW_BLOCK : BLOCK.SNOW_GRASS;
    } else if (height === SEA_LEVEL + 1 && riverMask > 0.35) {
      surfaceBlock = BLOCK.SAND;
    } else {
      surfaceBlock = BLOCK.GRASS;
    }

    return { height, biome, surfaceBlock, detail };
  }

  _sampleCaveComponents(wx, wy, wz) {
    const ux = Math.floor(wx / 4) * 4;
    const uy = Math.floor(wy / 4) * 4;
    const uz = Math.floor(wz / 4) * 4;
    const tx = (wx - ux) * 0.25;
    const ty = (wy - uy) * 0.25;
    const tz = (wz - uz) * 0.25;

    const fx = 0.044;
    const fy = 0.064;
    const n1 = trilinear(
      this.caveNoiseA.noise3D(ux * fx, uy * fy, uz * fx),
      this.caveNoiseA.noise3D((ux + 4) * fx, uy * fy, uz * fx),
      this.caveNoiseA.noise3D(ux * fx, (uy + 4) * fy, uz * fx),
      this.caveNoiseA.noise3D((ux + 4) * fx, (uy + 4) * fy, uz * fx),
      this.caveNoiseA.noise3D(ux * fx, uy * fy, (uz + 4) * fx),
      this.caveNoiseA.noise3D((ux + 4) * fx, uy * fy, (uz + 4) * fx),
      this.caveNoiseA.noise3D(ux * fx, (uy + 4) * fy, (uz + 4) * fx),
      this.caveNoiseA.noise3D((ux + 4) * fx, (uy + 4) * fy, (uz + 4) * fx),
      tx,
      ty,
      tz,
    );
    const n2 = trilinear(
      this.caveNoiseB.noise3D(ux * fx + 113.5, uy * fy - 71.2, uz * fx + 47.9),
      this.caveNoiseB.noise3D((ux + 4) * fx + 113.5, uy * fy - 71.2, uz * fx + 47.9),
      this.caveNoiseB.noise3D(ux * fx + 113.5, (uy + 4) * fy - 71.2, uz * fx + 47.9),
      this.caveNoiseB.noise3D((ux + 4) * fx + 113.5, (uy + 4) * fy - 71.2, uz * fx + 47.9),
      this.caveNoiseB.noise3D(ux * fx + 113.5, uy * fy - 71.2, (uz + 4) * fx + 47.9),
      this.caveNoiseB.noise3D((ux + 4) * fx + 113.5, uy * fy - 71.2, (uz + 4) * fx + 47.9),
      this.caveNoiseB.noise3D(ux * fx + 113.5, (uy + 4) * fy - 71.2, (uz + 4) * fx + 47.9),
      this.caveNoiseB.noise3D((ux + 4) * fx + 113.5, (uy + 4) * fy - 71.2, (uz + 4) * fx + 47.9),
      tx,
      ty,
      tz,
    );
    let cheese = -1;
    if (wy >= 4 && wy <= 34) {
      cheese = trilinear(
        this.caveNoiseA.fbm3D(ux * 0.027 + 200, uy * 0.038, uz * 0.027 - 150, 2, 2.0, 0.5),
        this.caveNoiseA.fbm3D((ux + 4) * 0.027 + 200, uy * 0.038, uz * 0.027 - 150, 2, 2.0, 0.5),
        this.caveNoiseA.fbm3D(ux * 0.027 + 200, (uy + 4) * 0.038, uz * 0.027 - 150, 2, 2.0, 0.5),
        this.caveNoiseA.fbm3D((ux + 4) * 0.027 + 200, (uy + 4) * 0.038, uz * 0.027 - 150, 2, 2.0, 0.5),
        this.caveNoiseA.fbm3D(ux * 0.027 + 200, uy * 0.038, (uz + 4) * 0.027 - 150, 2, 2.0, 0.5),
        this.caveNoiseA.fbm3D((ux + 4) * 0.027 + 200, uy * 0.038, (uz + 4) * 0.027 - 150, 2, 2.0, 0.5),
        this.caveNoiseA.fbm3D(ux * 0.027 + 200, (uy + 4) * 0.038, (uz + 4) * 0.027 - 150, 2, 2.0, 0.5),
        this.caveNoiseA.fbm3D((ux + 4) * 0.027 + 200, (uy + 4) * 0.038, (uz + 4) * 0.027 - 150, 2, 2.0, 0.5),
        tx,
        ty,
        tz,
      );
    }
    return { n1, n2, cheese };
  }

  _isCaveCarved(wx, wy, wz, surfaceY) {
    if (wy <= 0 || wy > surfaceY || wy >= CHUNK_HEIGHT - 1) return false;
    // Keep lake and river beds watertight
    if (surfaceY <= SEA_LEVEL + 1 && wy >= surfaceY - 3) return false;

    let wormThresh = 0.022;
    if (wy >= surfaceY - 4) {
      const mouthMask = this.caveNoiseB.noise2D(wx * 0.025, wz * 0.025);
      if (mouthMask <= 0.15) return false;
      wormThresh = 0.015;
    }

    const { n1, n2, cheese } = this._sampleCaveComponents(wx, wy, wz);
    if (n1 * n1 + n2 * n2 < wormThresh) {
      return true;
    }
    return wy >= 4 && wy <= 34 && wy <= surfaceY - 6 && cheese > 0.54;
  }

  _placeOres(cx, cz, blocks, biomeMap) {
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    const cellMinX = cx * 4 - 1;
    const cellMaxX = cx * 4 + 4;
    const cellMinZ = cz * 4 - 1;
    const cellMaxZ = cz * 4 + 4;

    for (const ore of ORE_CONFIGS) {
      const cellMinY = Math.floor(ore.minY / 4);
      const cellMaxY = Math.floor(ore.maxY / 4);

      for (let uy = cellMinY; uy <= cellMaxY; uy++) {
        for (let uz = cellMinZ; uz <= cellMaxZ; uz++) {
          for (let ux = cellMinX; ux <= cellMaxX; ux++) {
            const h = hash3D(this.seedInt ^ ore.salt, ux, uy, uz);
            if (h >= ore.chance) continue;

            const rng = mulberry32(Math.floor(h * 0xffffffff) ^ ore.salt);
            let vx = ux * 4 + ((rng() * 4) | 0);
            let vy = uy * 4 + ((rng() * 4) | 0);
            let vz = uz * 4 + ((rng() * 4) | 0);

            for (let step = 0; step < ore.size; step++) {
              if (vy >= ore.minY && vy <= ore.maxY) {
                const lx = vx - baseX;
                const lz = vz - baseZ;
                if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
                  if (!ore.biomeOnly || biomeMap[lz * CHUNK_SIZE + lx] === ore.biomeOnly) {
                    const idx = voxelIndex(lx, vy, lz);
                    if (blocks[idx] === BLOCK.STONE) {
                      blocks[idx] = ore.id;
                    }
                  }
                }
              }

              vx += ((rng() * 3) | 0) - 1;
              vy += ((rng() * 3) | 0) - 1;
              vz += ((rng() * 3) | 0) - 1;
            }
          }
        }
      }
    }
  }

  _isTreeLocalMax(ax, az) {
    const score = hash2D(this.seedInt ^ SALT.TREE_SCORE, ax, az);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (hash2D(this.seedInt ^ SALT.TREE_SCORE, ax + dx, az + dz) >= score) {
          return false;
        }
      }
    }
    return true;
  }

  _placeTrees(cx, cz, blocks) {
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    const setIfInChunk = (wx, wy, wz, id, overwriteLeaves = false) => {
      if (wy < 1 || wy >= CHUNK_HEIGHT) return;
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
      const idx = voxelIndex(lx, wy, lz);
      const cur = blocks[idx];
      if (
        cur === BLOCK.AIR ||
        (overwriteLeaves &&
          (cur === BLOCK.OAK_LEAVES ||
            cur === BLOCK.BIRCH_LEAVES ||
            cur === BLOCK.SPRUCE_LEAVES))
      ) {
        blocks[idx] = id;
      }
    };

    for (let az = baseZ - 3; az <= baseZ + CHUNK_SIZE + 2; az++) {
      for (let ax = baseX - 3; ax <= baseX + CHUNK_SIZE + 2; ax++) {
        if (!this._isTreeLocalMax(ax, az)) continue;

        const col = this._sampleColumn(ax, az);
        const treeChance = col.biome.def.treeChance;
        if (treeChance <= 0) continue;
        if (hash2D(this.seedInt ^ SALT.TREE_EXIST, ax, az) >= Math.min(1, treeChance * 25)) {
          continue;
        }
        if (col.height <= SEA_LEVEL) continue;
        if (col.surfaceBlock !== BLOCK.GRASS && col.surfaceBlock !== BLOCK.SNOW_GRASS) {
          continue;
        }
        if (this._isCaveCarved(ax, col.height, az, col.height)) continue;
        if (col.height + 11 >= CHUNK_HEIGHT) continue;

        const typeRoll = hash2D(this.seedInt ^ SALT.TREE_TYPE, ax, az);
        let species = 'oak';
        if (col.biome.id === BIOME.SNOWY_PEAKS) {
          species = 'spruce';
        } else if (col.biome.id === BIOME.FOREST && typeRoll < 0.32) {
          species = 'birch';
        } else if (typeRoll < 0.2) {
          species = 'birch';
        }

        const shapeSeed = hash2D(this.seedInt ^ SALT.TREE_SHAPE, ax, az);
        const rng = mulberry32(Math.floor(shapeSeed * 0xffffffff) ^ SALT.TREE_SHAPE);

        if (species === 'spruce') {
          const height = 6 + ((rng() * 3) | 0);
          const topY = col.height + height;

          // Conical spruce canopy
          setIfInChunk(ax, topY + 1, az, BLOCK.SPRUCE_LEAVES);

          for (let dy = -4; dy <= 0; dy++) {
            const ly = topY + dy;
            if (ly < col.height + 2) continue;
            const radius = dy === 0 || dy === -2 ? 1 : 2;
            for (let dz = -radius; dz <= radius; dz++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const manhattan = Math.abs(dx) + Math.abs(dz);
                if (radius === 1 && manhattan > 1) continue;
                if (radius === 2 && dy === -1 && manhattan > 3) continue;
                if (radius === 2 && dy === -3 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
                  continue;
                }
                if (radius === 2 && dy === -4 && manhattan > 2) continue;
                setIfInChunk(ax + dx, ly, az + dz, BLOCK.SPRUCE_LEAVES);
              }
            }
          }

          for (let y = col.height + 1; y < topY; y++) {
            setIfInChunk(ax, y, az, BLOCK.SPRUCE_LOG, true);
          }
        } else {
          const logId = species === 'birch' ? BLOCK.BIRCH_LOG : BLOCK.OAK_LOG;
          const leafId = species === 'birch' ? BLOCK.BIRCH_LEAVES : BLOCK.OAK_LEAVES;
          const height = (species === 'birch' ? 5 : 4) + ((rng() * 3) | 0);
          const topY = col.height + height;

          for (let dy = -2; dy <= 1; dy++) {
            const ly = topY + dy;
            const radius = dy <= -1 ? 2 : 1;
            for (let dz = -radius; dz <= radius; dz++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const cornerSkip = rng() < 0.65;
                if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && cornerSkip) {
                  continue;
                }
                if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
                setIfInChunk(ax + dx, ly, az + dz, leafId);
              }
            }
          }

          for (let y = col.height + 1; y <= topY; y++) {
            setIfInChunk(ax, y, az, logId, true);
          }
        }
      }
    }
  }

  _isCactusLocalMax(wx, wz) {
    const score = hash2D(this.seedInt ^ SALT.CACTUS_SCORE, wx, wz);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (hash2D(this.seedInt ^ SALT.CACTUS_SCORE, wx + dx, wz + dz) >= score) {
          return false;
        }
      }
    }
    return true;
  }

  _placeSurfaceDetails(cx, cz, blocks, heightMap, biomeMap) {
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = baseZ + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = baseX + lx;
        const colIdx = lz * CHUNK_SIZE + lx;
        const biomeId = biomeMap[colIdx];

        // Update heightMap to highest actual solid ground block (excluding canopy leaves)
        let surfY = heightMap[colIdx];
        while (surfY > 1 && blocks[voxelIndex(lx, surfY, lz)] === BLOCK.AIR) {
          surfY--;
        }
        heightMap[colIdx] = surfY;

        if (surfY <= SEA_LEVEL || surfY + 4 >= CHUNK_HEIGHT) continue;

        const topBlock = blocks[voxelIndex(lx, surfY, lz)];
        const aboveIdx = voxelIndex(lx, surfY + 1, lz);
        if (blocks[aboveIdx] !== BLOCK.AIR) continue;

        if (biomeId === BIOME.DESERT && topBlock === BLOCK.SAND) {
          if (
            this._isCactusLocalMax(wx, wz) &&
            hash2D(this.seedInt ^ SALT.CACTUS_EXIST, wx, wz) < 0.08
          ) {
            const cactusHeight =
              hash2D(this.seedInt ^ SALT.FLORA, wx, wz) < 0.55 ? 2 : 3;
            for (let dy = 1; dy <= cactusHeight; dy++) {
              const cIdx = voxelIndex(lx, surfY + dy, lz);
              if (blocks[cIdx] === BLOCK.AIR) {
                blocks[cIdx] = BLOCK.CACTUS;
              }
            }
          }
        } else if (topBlock === BLOCK.GRASS) {
          const r = hash2D(this.seedInt ^ SALT.FLORA, wx, wz);
          let grassCutoff = 0;
          let poppyCutoff = 0;
          let dandelionCutoff = 0;

          if (biomeId === BIOME.LUSH_VALLEY) {
            grassCutoff = 0.22;
            poppyCutoff = 0.265;
            dandelionCutoff = 0.31;
          } else if (biomeId === BIOME.PLAINS) {
            grassCutoff = 0.14;
            poppyCutoff = 0.165;
            dandelionCutoff = 0.19;
          } else if (biomeId === BIOME.FOREST) {
            grassCutoff = 0.1;
            poppyCutoff = 0.12;
            dandelionCutoff = 0.135;
          }

          if (r < grassCutoff) {
            blocks[aboveIdx] = BLOCK.TALL_GRASS;
          } else if (r < poppyCutoff) {
            blocks[aboveIdx] = BLOCK.POPPY;
          } else if (r < dandelionCutoff) {
            blocks[aboveIdx] = BLOCK.DANDELION;
          }
        }
      }
    }
  }

  getTerrainInfo(wx, wz) {
    const col = this._sampleColumn(wx, wz);
    return {
      height: col.height,
      biome: col.biome.id,
      temperature: col.biome.temperature,
      moisture: col.biome.moisture,
      surfaceBlock: col.surfaceBlock,
    };
  }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const light = new Uint8Array(CHUNK_VOLUME);
    const heightMap = new Uint8Array(CHUNK_AREA);
    const biomeMap = new Array(CHUNK_AREA);
    const surfaceBlocks = this._surfaceBlocks;
    const subBlocks = this._subBlocks;
    const temperatures = this._temperatures;
    const n1Grid = this._n1Grid;
    const n2Grid = this._n2Grid;
    const cheeseGrid = this._cheeseGrid;

    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    let maxSurfY = 4;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = baseZ + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = baseX + lx;
        const col = this._sampleColumn(wx, wz);
        const colIdx = lz * CHUNK_SIZE + lx;
        const surfY = col.height;

        heightMap[colIdx] = surfY;
        biomeMap[colIdx] = col.biome.id;
        surfaceBlocks[colIdx] = col.surfaceBlock;
        subBlocks[colIdx] = col.biome.def.subBlock;
        temperatures[colIdx] = col.biome.temperature;
        if (surfY > maxSurfY) maxSurfY = surfY;
      }
    }

    // 4x4x4 trilinear cave density lattice (5 x 5 x (maxGy + 1)) matching _sampleCaveComponents
    const maxGy = Math.ceil(maxSurfY / 4);
    const fx = 0.044;
    const fy = 0.064;
    for (let gy = 0; gy <= maxGy; gy++) {
      const wy = gy * 4;
      const yOff = gy * 25;
      const doCheese = gy <= 9;
      for (let gz = 0; gz < 5; gz++) {
        const wz = baseZ + gz * 4;
        const rowOff = yOff + gz * 5;
        for (let gx = 0; gx < 5; gx++) {
          const wx = baseX + gx * 4;
          const idx = rowOff + gx;
          n1Grid[idx] = this.caveNoiseA.noise3D(wx * fx, wy * fy, wz * fx);
          n2Grid[idx] = this.caveNoiseB.noise3D(
            wx * fx + 113.5,
            wy * fy - 71.2,
            wz * fx + 47.9,
          );
          if (doCheese) {
            cheeseGrid[idx] = this.caveNoiseA.fbm3D(
              wx * 0.027 + 200,
              wy * 0.038,
              wz * 0.027 - 150,
              2,
              2.0,
              0.5,
            );
          }
        }
      }
    }

    const interpGrid = (grid, lx, ly, lz) => {
      const base0 = (ly >> 2) * 25 + (lz >> 2) * 5 + (lx >> 2);
      const base1 = base0 + 25;
      return trilinear(
        grid[base0],
        grid[base0 + 1],
        grid[base1],
        grid[base1 + 1],
        grid[base0 + 5],
        grid[base0 + 6],
        grid[base1 + 5],
        grid[base1 + 6],
        (lx & 3) * 0.25,
        (ly & 3) * 0.25,
        (lz & 3) * 0.25,
      );
    };

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = baseZ + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = baseX + lx;
        const colIdx = lz * CHUNK_SIZE + lx;
        const surfY = heightMap[colIdx];
        const biomeId = biomeMap[colIdx];
        const surfBlock = surfaceBlocks[colIdx];
        const subBlock = subBlocks[colIdx];

        // Solid bedrock floor at y = 0
        blocks[voxelIndex(lx, 0, lz)] = BLOCK.BEDROCK;

        const isDesert = biomeId === BIOME.DESERT;
        const subDepth = isDesert ? 2 : 3;
        const sandstoneDepth = isDesert ? 6 : 0;
        const allowSurfaceMouth =
          surfY > SEA_LEVEL + 1 && this.caveNoiseB.noise2D(wx * 0.025, wz * 0.025) > 0.15;
        const lavaPool = this.caveNoiseB.noise2D(wx * 0.03 + 77.1, wz * 0.03 - 44.8);

        for (let ly = 1; ly <= surfY; ly++) {
          let carved = false;
          if (!(surfY <= SEA_LEVEL + 1 && ly >= surfY - 3)) {
            const nearSurface = ly >= surfY - 4;
            if (!nearSurface || allowSurfaceMouth) {
              const wormThresh = nearSurface ? 0.015 : 0.022;
              const n1 = interpGrid(n1Grid, lx, ly, lz);
              const n2 = interpGrid(n2Grid, lx, ly, lz);
              if (n1 * n1 + n2 * n2 < wormThresh) {
                carved = true;
              } else if (
                ly >= 4 &&
                ly <= 34 &&
                ly <= surfY - 6 &&
                interpGrid(cheeseGrid, lx, ly, lz) > 0.54
              ) {
                carved = true;
              }
            }
          }

          if (carved) {
            if (ly <= 8 && ((ly <= 5 && lavaPool > -0.1) || lavaPool > 0.45)) {
              blocks[voxelIndex(lx, ly, lz)] = BLOCK.LAVA;
            }
            continue;
          }

          let blockId;
          if (ly === surfY) {
            blockId = surfBlock;
          } else if (ly >= surfY - subDepth) {
            blockId = isDesert
              ? BLOCK.SAND
              : surfBlock === BLOCK.SNOW_BLOCK
                ? BLOCK.SNOW_BLOCK
                : subBlock;
          } else if (isDesert && ly >= surfY - sandstoneDepth) {
            blockId = BLOCK.SANDSTONE;
          } else {
            blockId = BLOCK.STONE;
          }
          blocks[voxelIndex(lx, ly, lz)] = blockId;
        }

        // Water & ice lakes up to SEA_LEVEL
        if (surfY < SEA_LEVEL) {
          const freeze = biomeId === BIOME.SNOWY_PEAKS || temperatures[colIdx] < 0.22;
          for (let ly = surfY + 1; ly <= SEA_LEVEL; ly++) {
            blocks[voxelIndex(lx, ly, lz)] =
              ly === SEA_LEVEL && freeze ? BLOCK.ICE : BLOCK.WATER;
          }
        }
      }
    }

    this._placeOres(cx, cz, blocks, biomeMap);
    this._placeTrees(cx, cz, blocks);
    this._placeSurfaceDetails(cx, cz, blocks, heightMap, biomeMap);

    return {
      cx,
      cz,
      blocks,
      light,
      heightMap,
      biomeMap,
      dirtyMesh: true,
      dirtyLight: true,
    };
  }

  findSafeSpawn(startX = 0, startZ = 0) {
    const sx = Math.round(startX);
    const sz = Math.round(startZ);
    const chunkCache = new Map();

    const getChunkCached = (cx, cz) => {
      const key = chunkKey(cx, cz);
      let chunk = chunkCache.get(key);
      if (!chunk) {
        chunk = this.generateChunk(cx, cz);
        chunkCache.set(key, chunk);
      }
      return chunk;
    };

    const tryCandidate = (wx, wz, maxPreferredHeight) => {
      const col = this._sampleColumn(wx, wz);
      if (col.height < SEA_LEVEL + 1 || col.height > maxPreferredHeight) return null;
      if (this._isCaveCarved(wx, col.height, wz, col.height)) return null;

      const { cx, cz } = worldToChunk(wx, wz);
      const { lx, lz } = worldToLocal(wx, col.height, wz);
      const chunk = getChunkCached(cx, cz);
      const surfY = chunk.heightMap[lz * CHUNK_SIZE + lx];
      if (surfY < SEA_LEVEL + 1 || surfY + 2 >= CHUNK_HEIGHT) return null;

      const floorId = chunk.blocks[voxelIndex(lx, surfY, lz)];
      const feetId = chunk.blocks[voxelIndex(lx, surfY + 1, lz)];
      const headId = chunk.blocks[voxelIndex(lx, surfY + 2, lz)];

      if (!isBlockSolid(floorId) || floorId === BLOCK.CACTUS) return null;
      if (isBlockSolid(feetId) || isBlockLiquid(feetId)) return null;
      if (isBlockSolid(headId) || isBlockLiquid(headId)) return null;

      return {
        x: wx,
        y: surfY + 1,
        z: wz,
        biome: chunk.biomeMap[lz * CHUNK_SIZE + lx],
      };
    };

    for (const maxH of [74, CHUNK_HEIGHT - 4]) {
      // Spiral search outward from (sx, sz)
      let x = sx;
      let z = sz;
      const first = tryCandidate(x, z, maxH);
      if (first) return first;

      let stepLen = 1;
      for (let ring = 0; ring < 256; ring++) {
        const dirs = [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ];
        for (let d = 0; d < 4; d++) {
          const [dx, dz] = dirs[d];
          for (let s = 0; s < stepLen; s++) {
            x += dx;
            z += dz;
            const hit = tryCandidate(x, z, maxH);
            if (hit) return hit;
          }
          if (d === 1 || d === 3) stepLen++;
        }
      }
    }

    const fallback = this.getTerrainInfo(sx, sz);
    return {
      x: sx,
      y: Math.max(SEA_LEVEL + 2, fallback.height + 1),
      z: sz,
      biome: fallback.biome,
    };
  }
}
