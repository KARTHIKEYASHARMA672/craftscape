import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, CHUNK_HEIGHT, CHUNK_SIZE, MAX_LIGHT, UV_INSET } from '../core/constants.js';
import { voxelIndex } from '../core/coords.js';
import { BLOCK, TILE, getBlockDef, isBlockOpaque } from '../core/blocks.js';
import { getTileUV } from './atlas.js';

const AO_CURVE = [0.54, 0.72, 0.86, 1.0];
const WATER_DROP = 0.125;
const CACTUS_INSET = 1 / 16;

// 6 orthogonal cube faces in CCW outward winding order.
// Corners order: v0 (bottom-left), v1 (bottom-right), v2 (top-right), v3 (top-left).
const CUBE_FACES = [
  {
    key: 'top',
    dir: [0, 1, 0],
    shade: 1.0,
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    key: 'bottom',
    dir: [0, -1, 0],
    shade: 0.58,
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    key: 'south',
    dir: [0, 0, 1],
    shade: 0.86,
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    key: 'north',
    dir: [0, 0, -1],
    shade: 0.86,
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  {
    key: 'east',
    dir: [1, 0, 0],
    shade: 0.76,
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    key: 'west',
    dir: [-1, 0, 0],
    shade: 0.76,
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
];

/**
 * Compute per-vertex Smooth Ambient Occlusion level (0..3).
 * Returns 0 when both adjacent side blocks occlude the corner; otherwise 3 minus occluder count.
 */
export function getFaceAO(side1Solid, side2Solid, cornerSolid) {
  if (side1Solid && side2Solid) return 0;
  return 3 - ((side1Solid ? 1 : 0) + (side2Solid ? 1 : 0) + (cornerSolid ? 1 : 0));
}

/**
 * Determine whether a quad's diagonal should flip to connect v0-v2 instead of v1-v3.
 */
export function shouldFlipQuad(ao0, ao1, ao2, ao3) {
  return ao0 + ao2 > ao1 + ao3;
}

class MeshBufferBuilder {
  constructor(initialVertices = 256) {
    this.capVerts = initialVertices;
    this.capIndices = initialVertices * 2;
    this.vertCount = 0;
    this.indexCount = 0;
    this.positions = new Float32Array(this.capVerts * 3);
    this.normals = new Float32Array(this.capVerts * 3);
    this.uvs = new Float32Array(this.capVerts * 2);
    this.colors = new Float32Array(this.capVerts * 3);
    this.lights = new Float32Array(this.capVerts * 2);
    this.indices = new Uint32Array(this.capIndices);
  }

  ensureCapacity(addVerts, addIndices) {
    if (this.vertCount + addVerts > this.capVerts) {
      let next = this.capVerts;
      while (next < this.vertCount + addVerts) next *= 2;
      this.capVerts = next;

      const nextPos = new Float32Array(next * 3);
      nextPos.set(this.positions);
      this.positions = nextPos;

      const nextNorm = new Float32Array(next * 3);
      nextNorm.set(this.normals);
      this.normals = nextNorm;

      const nextUv = new Float32Array(next * 2);
      nextUv.set(this.uvs);
      this.uvs = nextUv;

      const nextCol = new Float32Array(next * 3);
      nextCol.set(this.colors);
      this.colors = nextCol;

      const nextLight = new Float32Array(next * 2);
      nextLight.set(this.lights);
      this.lights = nextLight;
    }

    if (this.indexCount + addIndices > this.capIndices) {
      let nextIdxCap = this.capIndices;
      while (nextIdxCap < this.indexCount + addIndices) nextIdxCap *= 2;
      this.capIndices = nextIdxCap;

      const nextIdx = new Uint32Array(nextIdxCap);
      nextIdx.set(this.indices);
      this.indices = nextIdx;
    }
  }

  pushVertex(px, py, pz, nx, ny, nz, u, v, shade, skyNorm, blockNorm) {
    const vIdx = this.vertCount;
    const pOff = vIdx * 3;
    const uOff = vIdx * 2;

    this.positions[pOff] = px;
    this.positions[pOff + 1] = py;
    this.positions[pOff + 2] = pz;

    this.normals[pOff] = nx;
    this.normals[pOff + 1] = ny;
    this.normals[pOff + 2] = nz;

    this.uvs[uOff] = u;
    this.uvs[uOff + 1] = v;

    this.colors[pOff] = shade;
    this.colors[pOff + 1] = shade;
    this.colors[pOff + 2] = shade;

    this.lights[uOff] = skyNorm;
    this.lights[uOff + 1] = blockNorm;

    this.vertCount += 1;
    return vIdx;
  }

  pushQuad(verts, normal, uvRect, shades, skyLights, blockLights, flipDiagonal) {
    this.ensureCapacity(4, 6);
    const base = this.vertCount;
    const [nx, ny, nz] = normal;
    const { u0, v0, u1, v1 } = uvRect;
    const uvCoords = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];

    for (let i = 0; i < 4; i += 1) {
      const [px, py, pz] = verts[i];
      const [u, v] = uvCoords[i];
      this.pushVertex(px, py, pz, nx, ny, nz, u, v, shades[i], skyLights[i], blockLights[i]);
    }

    const idx = this.indices;
    const o = this.indexCount;
    if (flipDiagonal) {
      idx[o] = base;
      idx[o + 1] = base + 1;
      idx[o + 2] = base + 2;
      idx[o + 3] = base;
      idx[o + 4] = base + 2;
      idx[o + 5] = base + 3;
    } else {
      idx[o] = base + 1;
      idx[o + 1] = base + 2;
      idx[o + 2] = base + 3;
      idx[o + 3] = base + 1;
      idx[o + 4] = base + 3;
      idx[o + 5] = base;
    }
    this.indexCount += 6;
  }

  toMeshData() {
    return {
      positions: this.positions.slice(0, this.vertCount * 3),
      normals: this.normals.slice(0, this.vertCount * 3),
      uvs: this.uvs.slice(0, this.vertCount * 2),
      colors: this.colors.slice(0, this.vertCount * 3),
      lights: this.lights.slice(0, this.vertCount * 2),
      indices: this.indices.slice(0, this.indexCount),
    };
  }
}

function getSubTileUV(tileIndex, px0, py0, px1, py1) {
  const safeIndex = Math.max(0, Math.min(ATLAS_COLS * ATLAS_ROWS - 1, tileIndex | 0));
  const col = safeIndex % ATLAS_COLS;
  const row = Math.floor(safeIndex / ATLAS_COLS);
  const tileW = 1 / ATLAS_COLS;
  const tileH = 1 / ATLAS_ROWS;

  const baseU = col * tileW;
  const baseV = 1 - (row + 1) * tileH;
  return {
    u0: baseU + px0 * tileW + UV_INSET,
    u1: baseU + px1 * tileW - UV_INSET,
    v0: baseV + py0 * tileH + UV_INSET,
    v1: baseV + py1 * tileH - UV_INSET,
  };
}

function decodeLightValue(raw) {
  if (raw == null) return { sky: MAX_LIGHT, block: 0 };
  if (typeof raw === 'object') {
    return {
      sky: raw.sky ?? MAX_LIGHT,
      block: raw.block ?? 0,
    };
  }
  return {
    sky: (raw >> 4) & 0xf,
    block: raw & 0xf,
  };
}

/**
 * Build split { opaque, cutout, water } typed-array mesh buffers for a 16x128x16 chunk.
 * Coordinates are emitted chunk-local [0..16, 0..128, 0..16] for positioning at (cx*16, 0, cz*16).
 * Pure ES2024 with zero DOM/WebGL side effects.
 */
export function buildChunkMeshData(chunk, getBlockAt = null, getLightAt = null) {
  const opaque = new MeshBufferBuilder(512);
  const cutout = new MeshBufferBuilder(128);
  const water = new MeshBufferBuilder(128);

  const blocks = chunk?.blocks;
  if (!blocks) {
    return {
      opaque: opaque.toMeshData(),
      cutout: cutout.toMeshData(),
      water: water.toMeshData(),
    };
  }

  const light = chunk.light ?? null;
  const baseX = (chunk.cx ?? 0) * CHUNK_SIZE;
  const baseZ = (chunk.cz ?? 0) * CHUNK_SIZE;

  const sampleBlock = (lx, ly, lz) => {
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      if (ly < 0 || ly >= CHUNK_HEIGHT) return BLOCK.AIR;
      return blocks[voxelIndex(lx, ly, lz)];
    }
    if (getBlockAt) {
      const val = getBlockAt(baseX + lx, ly, baseZ + lz);
      if (val != null) return val;
    }
    return BLOCK.AIR;
  };

  const sampleLight = (lx, ly, lz) => {
    if (ly >= CHUNK_HEIGHT) return { sky: MAX_LIGHT, block: 0 };
    if (ly < 0) return { sky: 0, block: 0 };
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      if (light) return decodeLightValue(light[voxelIndex(lx, ly, lz)]);
      if (getLightAt) return decodeLightValue(getLightAt(baseX + lx, ly, baseZ + lz));
      return { sky: MAX_LIGHT, block: 0 };
    }
    if (getLightAt) {
      return decodeLightValue(getLightAt(baseX + lx, ly, baseZ + lz));
    }
    return { sky: MAX_LIGHT, block: 0 };
  };

  const computeVertexAOLight = (lx, ly, lz, dir, corner, isOpaqueCube, forceBlockLight = -1) => {
    const [nx, ny, nz] = dir;
    const bx = lx + nx;
    const by = ly + ny;
    const bz = lz + nz;

    const tx = nx === 0 ? (corner[0] === 1 ? 1 : -1) : 0;
    const ty = ny === 0 ? (corner[1] === 1 ? 1 : -1) : 0;
    const tz = nz === 0 ? (corner[2] === 1 ? 1 : -1) : 0;

    let s1x = bx;
    let s1y = by;
    let s1z = bz;
    let s2x = bx;
    let s2y = by;
    let s2z = bz;
    if (nx !== 0) {
      s1y += ty;
      s2z += tz;
    } else if (ny !== 0) {
      s1x += tx;
      s2z += tz;
    } else {
      s1x += tx;
      s2y += ty;
    }

    const cx = bx + tx;
    const cy = by + ty;
    const cz = bz + tz;

    const b1Opaque = isBlockOpaque(sampleBlock(s1x, s1y, s1z));
    const b2Opaque = isBlockOpaque(sampleBlock(s2x, s2y, s2z));
    const bcOpaque = isBlockOpaque(sampleBlock(cx, cy, cz));

    const ao = isOpaqueCube ? getFaceAO(b1Opaque, b2Opaque, bcOpaque) : 3;

    const cLight = sampleLight(bx, by, bz);
    let skySum = cLight.sky;
    let blkSum = cLight.block;
    let count = 1;

    if (!b1Opaque) {
      const l1 = sampleLight(s1x, s1y, s1z);
      skySum += l1.sky;
      blkSum += l1.block;
      count += 1;
    }
    if (!b2Opaque) {
      const l2 = sampleLight(s2x, s2y, s2z);
      skySum += l2.sky;
      blkSum += l2.block;
      count += 1;
    }
    if ((!b1Opaque || !b2Opaque) && !bcOpaque) {
      const lc = sampleLight(cx, cy, cz);
      skySum += lc.sky;
      blkSum += lc.block;
      count += 1;
    }

    const skyNorm = skySum / (count * MAX_LIGHT);
    const blockNorm = forceBlockLight >= 0 ? forceBlockLight : blkSum / (count * MAX_LIGHT);
    return { ao, skyNorm, blockNorm };
  };

  for (let ly = 0; ly < CHUNK_HEIGHT; ly += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const blockId = blocks[voxelIndex(lx, ly, lz)];
        if (blockId === BLOCK.AIR) continue;

        const def = getBlockDef(blockId);
        const renderType = def.renderType;

        if (renderType === 'cube') {
          const isOpaque = def.opaque;
          const isGlassOrIce = blockId === BLOCK.GLASS || blockId === BLOCK.ICE;
          const targetBucket = isOpaque ? opaque : (blockId === BLOCK.ICE ? water : cutout);

          for (let f = 0; f < CUBE_FACES.length; f += 1) {
            const face = CUBE_FACES[f];
            const [dx, dy, dz] = face.dir;
            const neighborId = sampleBlock(lx + dx, ly + dy, lz + dz);

            if (isBlockOpaque(neighborId)) continue;
            if (isGlassOrIce && neighborId === blockId) continue;

            const uvRect = getTileUV(def.tiles[face.key]);
            const verts = [];
            const aoVals = [];
            const shades = [];
            const skyLights = [];
            const blockLights = [];

            for (let c = 0; c < 4; c += 1) {
              const corner = face.corners[c];
              verts.push([lx + corner[0], ly + corner[1], lz + corner[2]]);
              const info = computeVertexAOLight(lx, ly, lz, face.dir, corner, isOpaque);
              aoVals.push(info.ao);
              shades.push(face.shade * AO_CURVE[info.ao]);
              skyLights.push(info.skyNorm);
              blockLights.push(info.blockNorm);
            }

            const flip = shouldFlipQuad(aoVals[0], aoVals[1], aoVals[2], aoVals[3]);
            targetBucket.pushQuad(verts, face.dir, uvRect, shades, skyLights, blockLights, flip);
          }
        } else if (renderType === 'liquid') {
          const aboveId = sampleBlock(lx, ly + 1, lz);
          const lowerTop = aboveId !== blockId && !isBlockOpaque(aboveId);
          const topOffset = lowerTop ? 1 - WATER_DROP : 1;
          const isLava = blockId === BLOCK.LAVA;
          const forcedBlockLight = isLava ? 1.0 : -1;

          for (let f = 0; f < CUBE_FACES.length; f += 1) {
            const face = CUBE_FACES[f];
            const [dx, dy, dz] = face.dir;
            const neighborId = sampleBlock(lx + dx, ly + dy, lz + dz);

            if (neighborId === blockId || isBlockOpaque(neighborId)) continue;

            const uvRect = getTileUV(def.tiles[face.key]);
            const verts = [];
            const shades = [];
            const skyLights = [];
            const blockLights = [];

            for (let c = 0; c < 4; c += 1) {
              const corner = face.corners[c];
              const yOff = corner[1] === 1 ? topOffset : 0;
              verts.push([lx + corner[0], ly + yOff, lz + corner[2]]);
              const info = computeVertexAOLight(lx, ly, lz, face.dir, corner, false, forcedBlockLight);
              shades.push(isLava ? 1.0 : face.shade);
              skyLights.push(isLava ? 1.0 : info.skyNorm);
              blockLights.push(info.blockNorm);
            }

            water.pushQuad(verts, face.dir, uvRect, shades, skyLights, blockLights, false);
          }
        } else if (renderType === 'cross') {
          const uvRect = getTileUV(def.tiles.north);
          const cellLight = sampleLight(lx, ly, lz);
          const sky = cellLight.sky / MAX_LIGHT;
          const blk = cellLight.block / MAX_LIGHT;
          const m = 0.15;
          const shades = [0.95, 0.95, 0.95, 0.95];
          const skies = [sky, sky, sky, sky];
          const blocksL = [blk, blk, blk, blk];

          cutout.pushQuad(
            [
              [lx + m, ly, lz + m],
              [lx + 1 - m, ly, lz + 1 - m],
              [lx + 1 - m, ly + 1, lz + 1 - m],
              [lx + m, ly + 1, lz + m],
            ],
            [0, 1, 0],
            uvRect,
            shades,
            skies,
            blocksL,
            true,
          );
          cutout.pushQuad(
            [
              [lx + 1 - m, ly, lz + m],
              [lx + m, ly, lz + 1 - m],
              [lx + m, ly + 1, lz + 1 - m],
              [lx + 1 - m, ly + 1, lz + m],
            ],
            [0, 1, 0],
            uvRect,
            shades,
            skies,
            blocksL,
            true,
          );
        } else if (renderType === 'torch') {
          const minX = 7 / 16;
          const maxX = 9 / 16;
          const maxY = 10 / 16;
          const minZ = 7 / 16;
          const maxZ = 9 / 16;
          const sideUV = getSubTileUV(TILE.TORCH, 7 / 16, 0, 9 / 16, 10 / 16);
          const topUV = getTileUV(TILE.TORCH_FLAME);
          const bottomUV = getSubTileUV(TILE.OAK_PLANKS, 7 / 16, 0, 9 / 16, 2 / 16);

          const torchShades = [1.0, 1.0, 1.0, 1.0];
          const cellSky = sampleLight(lx, ly, lz).sky / MAX_LIGHT;
          const skies = [cellSky, cellSky, cellSky, cellSky];
          const blocksL = [1.0, 1.0, 1.0, 1.0];

          for (let f = 0; f < CUBE_FACES.length; f += 1) {
            const face = CUBE_FACES[f];
            const [dx, dy, dz] = face.dir;
            if (face.key === 'bottom' && isBlockOpaque(sampleBlock(lx + dx, ly + dy, lz + dz))) {
              continue;
            }
            const uvRect = face.key === 'top' ? topUV : face.key === 'bottom' ? bottomUV : sideUV;
            const verts = face.corners.map(([cx, cy, cz]) => [
              lx + (cx ? maxX : minX),
              ly + (cy ? maxY : 0),
              lz + (cz ? maxZ : minZ),
            ]);
            cutout.pushQuad(verts, face.dir, uvRect, torchShades, skies, blocksL, true);
          }
        } else if (renderType === 'cactus') {
          const minXZ = CACTUS_INSET;
          const maxXZ = 1 - CACTUS_INSET;
          for (let f = 0; f < CUBE_FACES.length; f += 1) {
            const face = CUBE_FACES[f];
            const [dx, dy, dz] = face.dir;
            if (dy !== 0) {
              const neighborId = sampleBlock(lx + dx, ly + dy, lz + dz);
              if (isBlockOpaque(neighborId) || neighborId === BLOCK.CACTUS) continue;
            }
            const uvRect = getTileUV(def.tiles[face.key]);
            const verts = [];
            const aoVals = [];
            const shades = [];
            const skyLights = [];
            const blockLights = [];

            for (let c = 0; c < 4; c += 1) {
              const corner = face.corners[c];
              verts.push([
                lx + (corner[0] ? maxXZ : minXZ),
                ly + corner[1],
                lz + (corner[2] ? maxXZ : minXZ),
              ]);
              const info = computeVertexAOLight(lx, ly, lz, face.dir, corner, true);
              aoVals.push(info.ao);
              shades.push(face.shade * AO_CURVE[info.ao]);
              skyLights.push(info.skyNorm);
              blockLights.push(info.blockNorm);
            }
            const flip = shouldFlipQuad(aoVals[0], aoVals[1], aoVals[2], aoVals[3]);
            opaque.pushQuad(verts, face.dir, uvRect, shades, skyLights, blockLights, flip);
          }
        }
      }
    }
  }

  return {
    opaque: opaque.toMeshData(),
    cutout: cutout.toMeshData(),
    water: water.toMeshData(),
  };
}

/**
 * Convert a typed-array mesh slice into a Three.js BufferGeometry.
 * Returns null if the slice contains zero vertices.
 */
export function buildThreeGeometry(meshSlice) {
  if (!meshSlice || !meshSlice.positions || meshSlice.positions.length === 0) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(meshSlice.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(meshSlice.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(meshSlice.uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(meshSlice.colors, 3));
  geometry.setAttribute('aLight', new THREE.BufferAttribute(meshSlice.lights, 2));
  geometry.setIndex(new THREE.BufferAttribute(meshSlice.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
