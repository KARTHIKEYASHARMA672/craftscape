/**
 * Voxel chunk lighting solver: vertical sky-ray pass + bounded BFS flood-fill
 * for sky light (high nibble 0..15) and block light (low nibble 0..15).
 * Pure ES2024 module with zero DOM dependencies.
 */

import { CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_VOLUME, MAX_LIGHT } from '../core/constants.js';
import { voxelIndex } from '../core/coords.js';
import { BLOCK, BLOCK_DEFINITIONS } from '../core/blocks.js';

const QUEUE_CAPACITY = 65536; // 2x CHUNK_VOLUME ring buffer prevents overflow
const QUEUE_MASK = QUEUE_CAPACITY - 1;

const IS_OPAQUE = new Uint8Array(256);
const EMISSION = new Uint8Array(256);
const SKY_ATTEN = new Uint8Array(256);
const BFS_ATTEN = new Uint8Array(256);

const ATTENUATING_BLOCKS = new Set([
  BLOCK.OAK_LEAVES,
  BLOCK.BIRCH_LEAVES,
  BLOCK.SPRUCE_LEAVES,
  BLOCK.WATER,
  BLOCK.ICE,
  BLOCK.CACTUS,
]);

for (const def of BLOCK_DEFINITIONS) {
  IS_OPAQUE[def.id] = def.opaque ? 1 : 0;
  EMISSION[def.id] = Math.max(0, Math.min(MAX_LIGHT, def.lightLevel | 0));
  const softAtten = ATTENUATING_BLOCKS.has(def.id);
  SKY_ATTEN[def.id] = softAtten ? 1 : 0;
  BFS_ATTEN[def.id] = softAtten ? 2 : 1;
}

const skyQueue = new Int32Array(QUEUE_CAPACITY);
const blockQueue = new Int32Array(QUEUE_CAPACITY);
const inSkyQueue = new Uint8Array(CHUNK_VOLUME);
const inBlockQueue = new Uint8Array(CHUNK_VOLUME);

function clampLight(val) {
  const n = val | 0;
  return n < 0 ? 0 : n > MAX_LIGHT ? MAX_LIGHT : n;
}

export function getSkyLight(lightArr, idx) {
  return (lightArr[idx] >> 4) & 0x0f;
}

export function setSkyLight(lightArr, idx, val) {
  lightArr[idx] = (lightArr[idx] & 0x0f) | (clampLight(val) << 4);
}

export function getBlockLight(lightArr, idx) {
  return lightArr[idx] & 0x0f;
}

export function setBlockLight(lightArr, idx, val) {
  lightArr[idx] = (lightArr[idx] & 0xf0) | clampLight(val);
}

export function computeChunkLighting(chunk, getNeighborChunk = null) {
  const blocks = chunk.blocks;
  if (!chunk.light || chunk.light.length !== CHUNK_VOLUME) {
    chunk.light = new Uint8Array(CHUNK_VOLUME);
  }
  const light = chunk.light;
  light.fill(0);
  inSkyQueue.fill(0);
  inBlockQueue.fill(0);

  let skyHead = 0;
  let skyTail = 0;
  let blockHead = 0;
  let blockTail = 0;

  const pushSky = (idx) => {
    if (!inSkyQueue[idx]) {
      inSkyQueue[idx] = 1;
      skyQueue[skyTail] = idx;
      skyTail = (skyTail + 1) & QUEUE_MASK;
    }
  };

  const pushBlock = (idx) => {
    if (!inBlockQueue[idx]) {
      inBlockQueue[idx] = 1;
      blockQueue[blockTail] = idx;
      blockTail = (blockTail + 1) & QUEUE_MASK;
    }
  };

  // Pass 1: Vertical sky rays (top to bottom) and emissive source discovery
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      let sky = MAX_LIGHT;
      for (let ly = CHUNK_HEIGHT - 1; ly >= 0; ly--) {
        const idx = voxelIndex(lx, ly, lz);
        const id = blocks[idx];

        const emit = EMISSION[id];
        if (emit > 0) {
          light[idx] = (light[idx] & 0xf0) | emit;
          pushBlock(idx);
        }

        if (IS_OPAQUE[id]) {
          sky = 0;
        } else {
          if (sky > 0) {
            const atten = SKY_ATTEN[id];
            if (atten > 0) {
              sky = sky > atten ? sky - atten : 0;
            }
          }
          if (sky > 0) {
            light[idx] = (light[idx] & 0x0f) | (sky << 4);
          }
        }
      }
    }
  }

  // Pass 2: Seed skylight BFS along overhangs / lit borders where neighbors are darker
  for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
    const yBase = ly << 8;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const zBase = yBase | (lz << 4);
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = zBase | lx;
        const sky = (light[idx] >> 4) & 0x0f;
        if (sky <= 1) continue;

        let needsSpread = false;
        if (lx > 0 && !IS_OPAQUE[blocks[idx - 1]] && ((light[idx - 1] >> 4) & 0x0f) < sky - 1) {
          needsSpread = true;
        } else if (lx < 15 && !IS_OPAQUE[blocks[idx + 1]] && ((light[idx + 1] >> 4) & 0x0f) < sky - 1) {
          needsSpread = true;
        } else if (lz > 0 && !IS_OPAQUE[blocks[idx - 16]] && ((light[idx - 16] >> 4) & 0x0f) < sky - 1) {
          needsSpread = true;
        } else if (lz < 15 && !IS_OPAQUE[blocks[idx + 16]] && ((light[idx + 16] >> 4) & 0x0f) < sky - 1) {
          needsSpread = true;
        } else if (ly > 0 && !IS_OPAQUE[blocks[idx - 256]] && ((light[idx - 256] >> 4) & 0x0f) < sky - 1) {
          needsSpread = true;
        } else if (ly < CHUNK_HEIGHT - 1 && !IS_OPAQUE[blocks[idx + 256]] && ((light[idx + 256] >> 4) & 0x0f) < sky - 1) {
          needsSpread = true;
        }

        if (needsSpread) {
          pushSky(idx);
        }
      }
    }
  }

  // Pass 2b: Pull border light from already-lit neighboring chunks
  if (typeof getNeighborChunk === 'function' && typeof chunk.cx === 'number' && typeof chunk.cz === 'number') {
    const borders = [
      { nChunk: getNeighborChunk(chunk.cx - 1, chunk.cz), fixedX: 0, nFixedX: 15, varyZ: true },
      { nChunk: getNeighborChunk(chunk.cx + 1, chunk.cz), fixedX: 15, nFixedX: 0, varyZ: true },
      { nChunk: getNeighborChunk(chunk.cx, chunk.cz - 1), fixedZ: 0, nFixedZ: 15, varyZ: false },
      { nChunk: getNeighborChunk(chunk.cx, chunk.cz + 1), fixedZ: 15, nFixedZ: 0, varyZ: false },
    ];

    for (const b of borders) {
      const nLight = b.nChunk?.light;
      if (!nLight || nLight.length !== CHUNK_VOLUME) continue;

      for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
        for (let i = 0; i < CHUNK_SIZE; i++) {
          const lx = b.varyZ ? b.fixedX : i;
          const lz = b.varyZ ? i : b.fixedZ;
          const nlx = b.varyZ ? b.nFixedX : i;
          const nlz = b.varyZ ? i : b.nFixedZ;

          const idx = voxelIndex(lx, ly, lz);
          const id = blocks[idx];
          if (IS_OPAQUE[id]) continue;

          const atten = BFS_ATTEN[id];
          const nIdx = voxelIndex(nlx, ly, nlz);
          const nVal = nLight[nIdx];
          const nSky = (nVal >> 4) & 0x0f;
          const nBlock = nVal & 0x0f;

          if (nSky - atten > ((light[idx] >> 4) & 0x0f)) {
            light[idx] = (light[idx] & 0x0f) | ((nSky - atten) << 4);
            if (nSky - atten > 1) pushSky(idx);
          }
          if (nBlock - atten > (light[idx] & 0x0f)) {
            light[idx] = (light[idx] & 0xf0) | (nBlock - atten);
            if (nBlock - atten > 1) pushBlock(idx);
          }
        }
      }
    }
  }

  // Pass 3a: Bounded BFS flood-fill for sky light
  while (skyHead !== skyTail) {
    const idx = skyQueue[skyHead];
    skyHead = (skyHead + 1) & QUEUE_MASK;
    inSkyQueue[idx] = 0;

    const val = (light[idx] >> 4) & 0x0f;
    if (val <= 1) continue;

    const lx = idx & 15;
    const lz = (idx >> 4) & 15;
    const ly = idx >> 8;

    const relaxSky = (nIdx) => {
      const nId = blocks[nIdx];
      if (IS_OPAQUE[nId]) return;
      const nextVal = val - BFS_ATTEN[nId];
      if (nextVal > ((light[nIdx] >> 4) & 0x0f)) {
        light[nIdx] = (light[nIdx] & 0x0f) | (nextVal << 4);
        if (nextVal > 1) pushSky(nIdx);
      }
    };

    if (lx > 0) relaxSky(idx - 1);
    if (lx < 15) relaxSky(idx + 1);
    if (lz > 0) relaxSky(idx - 16);
    if (lz < 15) relaxSky(idx + 16);
    if (ly > 0) relaxSky(idx - 256);
    if (ly < CHUNK_HEIGHT - 1) relaxSky(idx + 256);
  }

  // Pass 3b: Bounded BFS flood-fill for block light
  while (blockHead !== blockTail) {
    const idx = blockQueue[blockHead];
    blockHead = (blockHead + 1) & QUEUE_MASK;
    inBlockQueue[idx] = 0;

    const val = light[idx] & 0x0f;
    if (val <= 1) continue;

    const lx = idx & 15;
    const lz = (idx >> 4) & 15;
    const ly = idx >> 8;

    const relaxBlock = (nIdx) => {
      const nId = blocks[nIdx];
      if (IS_OPAQUE[nId]) return;
      const nextVal = val - BFS_ATTEN[nId];
      if (nextVal > (light[nIdx] & 0x0f)) {
        light[nIdx] = (light[nIdx] & 0xf0) | nextVal;
        if (nextVal > 1) pushBlock(nIdx);
      }
    };

    if (lx > 0) relaxBlock(idx - 1);
    if (lx < 15) relaxBlock(idx + 1);
    if (lz > 0) relaxBlock(idx - 16);
    if (lz < 15) relaxBlock(idx + 16);
    if (ly > 0) relaxBlock(idx - 256);
    if (ly < CHUNK_HEIGHT - 1) relaxBlock(idx + 256);
  }

  chunk.dirtyLight = false;
  return light;
}
