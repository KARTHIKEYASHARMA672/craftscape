import { describe, expect, it } from 'vitest';
import { ATLAS_COLS, ATLAS_ROWS, CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, UV_INSET } from '../src/core/constants.js';
import { voxelIndex } from '../src/core/coords.js';
import { BLOCK, TILE } from '../src/core/blocks.js';
import { getTileUV, renderItemIconDataUrl } from '../src/render/atlas.js';
import { buildChunkMeshData, buildThreeGeometry, getFaceAO, shouldFlipQuad } from '../src/render/mesher.js';
import { getSkyState, SkySystem } from '../src/render/sky.js';
import { ParticleSystem } from '../src/render/particles.js';

function makeEmptyChunk(cx = 0, cz = 0) {
  return {
    cx,
    cz,
    blocks: new Uint8Array(CHUNK_VOLUME),
    light: new Uint8Array(CHUNK_VOLUME).fill(0xf0),
  };
}

function setLocalBlock(chunk, lx, ly, lz, blockId) {
  chunk.blocks[voxelIndex(lx, ly, lz)] = blockId;
}

describe('Texture Atlas UVs', () => {
  it('keeps all tile UVs inside [0, 1] with exact UV_INSET padding and flipY orientation', () => {
    const expectedSpan = 1 / ATLAS_COLS - 2 * UV_INSET;

    for (let idx = 0; idx < ATLAS_COLS * ATLAS_ROWS; idx += 1) {
      const uv = getTileUV(idx);
      expect(uv.u0).toBeGreaterThanOrEqual(UV_INSET - 1e-9);
      expect(uv.v0).toBeGreaterThanOrEqual(UV_INSET - 1e-9);
      expect(uv.u1).toBeLessThanOrEqual(1 - UV_INSET + 1e-9);
      expect(uv.v1).toBeLessThanOrEqual(1 - UV_INSET + 1e-9);
      expect(uv.u1 - uv.u0).toBeCloseTo(expectedSpan, 6);
      expect(uv.v1 - uv.v0).toBeCloseTo(expectedSpan, 6);
    }

    // Row 0 (CanvasTexture flipY = true) maps top edge to v near 1.0
    const tile0 = getTileUV(TILE.STONE);
    expect(tile0.v1).toBeCloseTo(1 - UV_INSET, 6);
    expect(tile0.v0).toBeCloseTo(1 - 1 / ATLAS_ROWS + UV_INSET, 6);

    // Row 15 maps bottom edge to v near 0.0
    const lastTile = getTileUV(ATLAS_COLS * ATLAS_ROWS - 1);
    expect(lastTile.v0).toBeCloseTo(UV_INSET, 6);
  });
});

describe('Chunk Mesher Face Culling & Geometry', () => {
  it('culls all 24 internal faces on a solid 2x2x2 cluster leaving 24 outer faces', () => {
    const chunk = makeEmptyChunk();
    for (let x = 4; x <= 5; x += 1) {
      for (let y = 10; y <= 11; y += 1) {
        for (let z = 4; z <= 5; z += 1) {
          setLocalBlock(chunk, x, y, z, BLOCK.STONE);
        }
      }
    }

    const mesh = buildChunkMeshData(chunk);
    // 24 outer faces -> 96 vertices, 144 triangle indices
    expect(mesh.opaque.positions.length / 3).toBe(24 * 4);
    expect(mesh.opaque.indices.length).toBe(24 * 6);
    expect(mesh.cutout.positions.length).toBe(0);
    expect(mesh.water.positions.length).toBe(0);
  });

  it('culls faces seamlessly across chunk boundaries using getBlockAt', () => {
    const chunk = makeEmptyChunk(0, 0);
    setLocalBlock(chunk, 15, 20, 5, BLOCK.STONE);
    setLocalBlock(chunk, 0, 20, 5, BLOCK.STONE);

    const isolated = buildChunkMeshData(chunk);
    // 2 separated stone cubes -> 12 faces = 48 vertices
    expect(isolated.opaque.positions.length / 3).toBe(48);

    const withNeighbors = buildChunkMeshData(chunk, (wx, wy, wz) => {
      if (wy === 20 && wz === 5 && (wx === 16 || wx === -1)) {
        return BLOCK.STONE;
      }
      return BLOCK.AIR;
    });
    // Both cross-chunk faces (+X at x=16, -X at x=-1) are culled -> 10 faces = 40 vertices
    expect(withNeighbors.opaque.positions.length / 3).toBe(40);
    expect(withNeighbors.opaque.indices.length).toBe(60);
  });

  it('culls shared faces between adjacent same-type transparent cubes (GLASS / ICE)', () => {
    const chunk = makeEmptyChunk();
    setLocalBlock(chunk, 2, 12, 2, BLOCK.GLASS);
    setLocalBlock(chunk, 3, 12, 2, BLOCK.GLASS);
    setLocalBlock(chunk, 6, 12, 2, BLOCK.ICE);
    setLocalBlock(chunk, 7, 12, 2, BLOCK.ICE);

    const mesh = buildChunkMeshData(chunk);
    // Each 2-block row has 10 exposed faces -> 40 vertices
    expect(mesh.cutout.positions.length / 3).toBe(40);
    expect(mesh.water.positions.length / 3).toBe(40);
  });
});

describe('Smooth AO & Quad Diagonal Flip', () => {
  it('computes corner occlusion levels accurately', () => {
    expect(getFaceAO(true, true, false)).toBe(0);
    expect(getFaceAO(true, true, true)).toBe(0);
    expect(getFaceAO(false, false, false)).toBe(3);
    expect(getFaceAO(true, false, false)).toBe(2);
    expect(getFaceAO(false, true, false)).toBe(2);
    expect(getFaceAO(false, false, true)).toBe(2);
    expect(getFaceAO(true, false, true)).toBe(1);
    expect(getFaceAO(false, true, true)).toBe(1);
  });

  it('evaluates diagonal flip condition ao0 + ao2 > ao1 + ao3 and flips quad indices in mesh', () => {
    expect(shouldFlipQuad(3, 0, 3, 3)).toBe(true);
    expect(shouldFlipQuad(0, 3, 3, 3)).toBe(false);
    expect(shouldFlipQuad(3, 3, 3, 3)).toBe(false);

    // Case A: occlude v0 of top face at (5, 10, 5): v0 = (5, 11, 6) touches (4, 11, 5) & (5, 11, 6)
    const chunkA = makeEmptyChunk();
    setLocalBlock(chunkA, 5, 10, 5, BLOCK.STONE);
    setLocalBlock(chunkA, 4, 11, 5, BLOCK.STONE);
    setLocalBlock(chunkA, 5, 11, 6, BLOCK.STONE);
    const meshA = buildChunkMeshData(chunkA);

    // First block iterated at (4, 11, 5), second at (5, 10, 5), third at (5, 11, 6).
    // Verify top face of (5, 10, 5) has an occluded vertex shade ~0.54 and non-flipped diagonal (v1-v3)
    const topFaceStartA = findTopFaceVertexOffset(meshA.opaque, 5, 11, 5);
    expect(topFaceStartA).toBeGreaterThanOrEqual(0);
    expect(meshA.opaque.colors[topFaceStartA * 3]).toBeCloseTo(0.54, 2);
    const triIdxA = findFaceIndices(meshA.opaque, topFaceStartA);
    expect(triIdxA).toEqual([
      topFaceStartA + 1, topFaceStartA + 2, topFaceStartA + 3,
      topFaceStartA + 1, topFaceStartA + 3, topFaceStartA,
    ]);

    // Case B: occlude v1 of top face at (5, 10, 5): v1 = (6, 11, 6) touches (6, 11, 5) & (5, 11, 6)
    // Now ao1 = 0, ao0 = 2, ao2 = 2, ao3 = 3 => ao0 + ao2 > ao1 + ao3 -> flips to (0-2) diagonal!
    const chunkB = makeEmptyChunk();
    setLocalBlock(chunkB, 5, 10, 5, BLOCK.STONE);
    setLocalBlock(chunkB, 6, 11, 5, BLOCK.STONE);
    setLocalBlock(chunkB, 5, 11, 6, BLOCK.STONE);
    const meshB = buildChunkMeshData(chunkB);

    const topFaceStartB = findTopFaceVertexOffset(meshB.opaque, 5, 11, 5);
    expect(topFaceStartB).toBeGreaterThanOrEqual(0);
    expect(meshB.opaque.colors[(topFaceStartB + 1) * 3]).toBeCloseTo(0.54, 2);
    const triIdxB = findFaceIndices(meshB.opaque, topFaceStartB);
    expect(triIdxB).toEqual([
      topFaceStartB, topFaceStartB + 1, topFaceStartB + 2,
      topFaceStartB, topFaceStartB + 2, topFaceStartB + 3,
    ]);
  });
});

function findTopFaceVertexOffset(slice, x, y, z) {
  // Top face emits v0=(x, y, z+1), v1=(x+1, y, z+1), v2=(x+1, y, z), v3=(x, y, z) with normal (0, 1, 0)
  for (let i = 0; i < slice.positions.length / 3; i += 4) {
    const nx = slice.normals[i * 3];
    const ny = slice.normals[i * 3 + 1];
    const nz = slice.normals[i * 3 + 2];
    const vx = slice.positions[i * 3];
    const vy = slice.positions[i * 3 + 1];
    const vz = slice.positions[i * 3 + 2];
    if (ny === 1 && nx === 0 && nz === 0 && vx === x && vy === y && vz === z + 1) {
      return i;
    }
  }
  return -1;
}

function findFaceIndices(slice, baseVertex) {
  for (let i = 0; i < slice.indices.length; i += 6) {
    const group = Array.from(slice.indices.slice(i, i + 6));
    if (group.every((v) => v >= baseVertex && v < baseVertex + 4)) {
      return group;
    }
  }
  return null;
}

describe('Liquid, Cutout Buckets, & Three.js BufferGeometry', () => {
  it('lowers water top face (< 1.0) when air is above and places liquids into water bucket', () => {
    const chunk = makeEmptyChunk();
    setLocalBlock(chunk, 4, 0, 4, BLOCK.WATER);

    const mesh = buildChunkMeshData(chunk);
    expect(mesh.opaque.positions.length).toBe(0);
    expect(mesh.cutout.positions.length).toBe(0);
    expect(mesh.water.positions.length).toBeGreaterThan(0);

    let maxTopY = 0;
    for (let i = 0; i < mesh.water.positions.length; i += 3) {
      if (mesh.water.positions[i + 1] > maxTopY) {
        maxTopY = mesh.water.positions[i + 1];
      }
    }
    expect(maxTopY).toBeCloseTo(0.875, 5);
    expect(maxTopY).toBeLessThan(1.0);
  });

  it('keeps submerged water full height (1.0) and emits LAVA with full blockLight = 1.0', () => {
    const chunk = makeEmptyChunk();
    setLocalBlock(chunk, 2, 10, 2, BLOCK.WATER);
    setLocalBlock(chunk, 2, 11, 2, BLOCK.WATER);
    setLocalBlock(chunk, 8, 5, 8, BLOCK.LAVA);

    const mesh = buildChunkMeshData(chunk);
    expect(mesh.water.positions.length).toBeGreaterThan(0);

    // Check lava vertices have blockLight = 1.0
    let foundFullLavaLight = false;
    for (let i = 0; i < mesh.water.positions.length / 3; i += 1) {
      const px = mesh.water.positions[i * 3];
      if (px >= 8 && mesh.water.lights[i * 2 + 1] === 1.0) {
        foundFullLavaLight = true;
        break;
      }
    }
    expect(foundFullLavaLight).toBe(true);
  });

  it('routes POPPY and TORCH into cutout bucket and emits Three BufferGeometry cleanly', () => {
    const chunk = makeEmptyChunk();
    setLocalBlock(chunk, 3, 20, 3, BLOCK.POPPY);
    setLocalBlock(chunk, 6, 20, 6, BLOCK.TORCH);

    const mesh = buildChunkMeshData(chunk);
    expect(mesh.opaque.positions.length).toBe(0);
    expect(mesh.water.positions.length).toBe(0);
    expect(mesh.cutout.positions.length).toBeGreaterThan(0);

    // Empty slice returns null
    expect(buildThreeGeometry(mesh.opaque)).toBeNull();

    // Non-empty slice produces valid BufferGeometry with aLight attribute
    const geom = buildThreeGeometry(mesh.cutout);
    expect(geom).not.toBeNull();
    expect(geom.getAttribute('position').count).toBe(mesh.cutout.positions.length / 3);
    expect(geom.getAttribute('aLight').itemSize).toBe(2);
    expect(geom.getIndex().count).toBe(mesh.cutout.indices.length);
    geom.dispose();
  });

  it('clamps out-of-bounds y cleanly at chunk top and bottom', () => {
    const chunk = makeEmptyChunk();
    setLocalBlock(chunk, 1, 0, 1, BLOCK.BEDROCK);
    setLocalBlock(chunk, 1, CHUNK_HEIGHT - 1, 1, BLOCK.STONE);
    const mesh = buildChunkMeshData(chunk);
    expect(mesh.opaque.positions.length / 3).toBe(48);
    expect(CHUNK_SIZE).toBe(16);
  });
});

describe('Sky State & Day/Night Cycle', () => {
  it('computes bright day at noon, warm twilight at sunset, and dark starry night at midnight', () => {
    const noon = getSkyState(0.5);
    expect(noon.sunIntensity).toBeGreaterThanOrEqual(0.95);
    expect(noon.starOpacity).toBe(0);
    expect(noon.phaseName).toBe('day');
    const noonR = (noon.skyColorHex >> 16) & 255;
    const noonB = noon.skyColorHex & 255;
    expect(noonB).toBeGreaterThan(noonR);

    const sunset = getSkyState(0.75);
    expect(sunset.phaseName).toBe('sunset');
    expect(sunset.sunIntensity).toBeGreaterThan(0.25);
    expect(sunset.sunIntensity).toBeLessThan(0.7);
    const sunsetFogR = (sunset.fogColorHex >> 16) & 255;
    const sunsetFogB = sunset.fogColorHex & 255;
    expect(sunsetFogR).toBeGreaterThan(sunsetFogB);

    const sunrise = getSkyState(0.25);
    expect(sunrise.phaseName).toBe('sunrise');

    const midnight0 = getSkyState(0.0);
    const midnight1 = getSkyState(1.0);
    expect(midnight0.phaseName).toBe('night');
    expect(midnight0.sunIntensity).toBeLessThanOrEqual(0.25);
    expect(midnight0.starOpacity).toBe(1);
    expect(midnight1.sunIntensity).toBeCloseTo(midnight0.sunIntensity, 5);
  });

  it('runs SkySystem, ParticleSystem, and headless icon guard cleanly without DOM', () => {
    expect(renderItemIconDataUrl(BLOCK.GRASS)).toBe('');

    const added = [];
    const mockScene = {
      add(...objs) { added.push(...objs); },
      remove(...objs) {
        for (const obj of objs) {
          const idx = added.indexOf(obj);
          if (idx >= 0) added.splice(idx, 1);
        }
      },
    };

    const sky = new SkySystem(mockScene);
    const noonState = sky.update(0.016, 0.5, { x: 10, y: 50, z: -12 }, 80, false);
    expect(noonState.phaseName).toBe('day');
    const underwaterState = sky.update(0.016, 0.75, { x: 10, y: 38, z: -12 }, 80, true);
    expect(underwaterState.phaseName).toBe('sunset');
    expect(mockScene.fog.far).toBeLessThanOrEqual(24);
    sky.dispose();

    const particles = new ParticleSystem(mockScene);
    particles.spawnBlockBreak(4, 10, 4, '#569c42', 14);
    particles.spawnExplosion(6, 12, 6, 32);
    particles.spawnTorchEmber(2, 10, 2);
    expect(particles.particles.length).toBe(47);
    particles.update(0.05);
    expect(particles.mesh.count).toBe(47);
    for (let step = 0; step < 15; step += 1) {
      particles.update(0.1);
    }
    expect(particles.particles.length).toBe(0);
    expect(particles.mesh.count).toBe(0);
    particles.dispose();
  });
});
