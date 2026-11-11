/**
 * Biome definitions and continuous multi-axis climate classification.
 * Pure ES2024 module with zero DOM dependencies.
 */

import { BLOCK } from '../core/blocks.js';

export const BIOME = Object.freeze({
  PLAINS: 'plains',
  FOREST: 'forest',
  DESERT: 'desert',
  SNOWY_PEAKS: 'snowy_peaks',
  LUSH_VALLEY: 'lush_valley',
});

export const BIOME_DEFS = Object.freeze({
  [BIOME.PLAINS]: Object.freeze({
    id: BIOME.PLAINS,
    name: 'Plains',
    topBlock: BLOCK.GRASS,
    subBlock: BLOCK.DIRT,
    baseHeight: 45,
    heightScale: 6,
    treeChance: 0.004,
    grassColor: '#569c42',
  }),
  [BIOME.FOREST]: Object.freeze({
    id: BIOME.FOREST,
    name: 'Forest',
    topBlock: BLOCK.GRASS,
    subBlock: BLOCK.DIRT,
    baseHeight: 48,
    heightScale: 10,
    treeChance: 0.026,
    grassColor: '#478b39',
  }),
  [BIOME.DESERT]: Object.freeze({
    id: BIOME.DESERT,
    name: 'Desert',
    topBlock: BLOCK.SAND,
    subBlock: BLOCK.SANDSTONE,
    baseHeight: 45,
    heightScale: 7,
    treeChance: 0,
    grassColor: '#9e9b52',
  }),
  [BIOME.SNOWY_PEAKS]: Object.freeze({
    id: BIOME.SNOWY_PEAKS,
    name: 'Snowy Peaks',
    topBlock: BLOCK.SNOW_GRASS,
    subBlock: BLOCK.DIRT,
    baseHeight: 60,
    heightScale: 26,
    treeChance: 0.011,
    grassColor: '#9eb8b2',
  }),
  [BIOME.LUSH_VALLEY]: Object.freeze({
    id: BIOME.LUSH_VALLEY,
    name: 'Lush Valley',
    topBlock: BLOCK.GRASS,
    subBlock: BLOCK.DIRT,
    baseHeight: 41,
    heightScale: 8,
    treeChance: 0.015,
    grassColor: '#4eb347',
  }),
});

const BIOME_ORDER = [
  BIOME.SNOWY_PEAKS,
  BIOME.DESERT,
  BIOME.LUSH_VALLEY,
  BIOME.FOREST,
  BIOME.PLAINS,
];

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function evalClimateAxis(noiseOrValue, wx, wz, scale, offsetX, offsetZ) {
  if (typeof noiseOrValue === 'number') {
    return Math.max(0, Math.min(1, noiseOrValue));
  }
  const raw = typeof noiseOrValue?.fbm2D === 'function'
    ? noiseOrValue.fbm2D(wx * scale + offsetX, wz * scale + offsetZ, 3, 2.0, 0.5)
    : noiseOrValue.noise2D(wx * scale + offsetX, wz * scale + offsetZ);
  return 0.5 + 0.5 * Math.tanh(raw * 2.2);
}

/**
 * Compute normalized smooth blend weights summing to 1.0 across all 5 biomes.
 */
export function computeBiomeWeights(temperature, moisture, ridge) {
  const wPeaks = Math.min(
    1,
    smoothstep(0.56, 0.72, ridge) +
      smoothstep(0.32, 0.16, temperature) * smoothstep(0.35, 0.52, ridge),
  );
  const nonPeak = 1 - wPeaks;

  const wDesertRaw =
    smoothstep(0.50, 0.66, temperature) * smoothstep(0.54, 0.36, moisture);
  const wValleyRaw =
    smoothstep(0.50, 0.32, ridge) * smoothstep(0.50, 0.68, moisture);
  const wForestRaw =
    smoothstep(0.42, 0.58, moisture) *
    smoothstep(0.22, 0.36, temperature) *
    (1 - wDesertRaw * 0.85) *
    (1 - wValleyRaw * 0.72);
  const wPlainsRaw = 0.28;

  const restSum = wDesertRaw + wValleyRaw + wForestRaw + wPlainsRaw;
  return {
    [BIOME.SNOWY_PEAKS]: wPeaks,
    [BIOME.DESERT]: nonPeak * (wDesertRaw / restSum),
    [BIOME.LUSH_VALLEY]: nonPeak * (wValleyRaw / restSum),
    [BIOME.FOREST]: nonPeak * (wForestRaw / restSum),
    [BIOME.PLAINS]: nonPeak * (wPlainsRaw / restSum),
  };
}

/**
 * Sample the dominant biome and climate axes at world coordinates (wx, wz).
 */
export function sampleBiome(wx, wz, tempNoise, moistNoise, ridgeNoise) {
  const temperature = evalClimateAxis(tempNoise, wx, wz, 0.0048, 17.3, -29.1);
  const moisture = evalClimateAxis(moistNoise, wx, wz, 0.0048, -41.7, 13.9);
  const ridge = evalClimateAxis(ridgeNoise, wx, wz, 0.0056, 53.2, 67.4);

  const weights = computeBiomeWeights(temperature, moisture, ridge);

  let bestId = BIOME.PLAINS;
  let bestWeight = -1;
  for (const id of BIOME_ORDER) {
    if (weights[id] > bestWeight) {
      bestWeight = weights[id];
      bestId = id;
    }
  }

  const def = BIOME_DEFS[bestId];
  return {
    id: def.id,
    name: def.name,
    def,
    temperature,
    moisture,
    ridge,
  };
}
