/**
 * Deterministic PRNG, spatial coordinate hashes, and 2D/3D Simplex + FBM noise.
 * Pure ES2024 module with zero DOM or global state dependencies.
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

// 12 unit cube edge-midpoint gradients used by both 2D and 3D simplex noise
const GRAD3 = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

function resolveSeed(seed) {
  if (typeof seed === 'number') {
    return Number.isInteger(seed) ? seed >>> 0 : hashString(String(seed));
  }
  return hashString(String(seed ?? ''));
}

function mix32(h) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * FNV-1a 32-bit string hash returning an unsigned 32-bit integer.
 */
export function hashString(str) {
  const s = String(str ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mulberry32 deterministic 32-bit PRNG returning values in [0, 1).
 */
export function mulberry32(seed) {
  let a = resolveSeed(seed);
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 2D integer spatial hash returning values in [0, 1).
 */
export function hash2D(seed, x, z) {
  const s = resolveSeed(seed);
  let h = s ^ Math.imul(x | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x165667b1);
  h ^= Math.imul(z | 0, 0x9e3779b1);
  return mix32(h) / 4294967296;
}

/**
 * Deterministic 3D integer spatial hash returning values in [0, 1).
 */
export function hash3D(seed, x, y, z) {
  const s = resolveSeed(seed);
  let h = s ^ Math.imul(x | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x165667b1);
  h ^= Math.imul(y | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae3d);
  h ^= Math.imul(z | 0, 0x9e3779b1);
  return mix32(h) / 4294967296;
}

function clampUnit(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export class SimplexNoise {
  constructor(seed = 0) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }

    this.perm = new Uint8Array(512);
    this.permMod12x3 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      const val = p[i & 255];
      this.perm[i] = val;
      this.permMod12x3[i] = (val % 12) * 3;
    }
  }

  noise2D(x, z) {
    const { perm, permMod12x3 } = this;
    const s = (x + z) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(z + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const z0 = z - (j - t);

    const i1 = x0 > z0 ? 1 : 0;
    const j1 = x0 > z0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const z1 = z0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const z2 = z0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0;
    let t0 = 0.5 - x0 * x0 - z0 * z0;
    if (t0 > 0) {
      t0 *= t0;
      const gi0 = permMod12x3[ii + perm[jj]];
      n0 = t0 * t0 * (GRAD3[gi0] * x0 + GRAD3[gi0 + 1] * z0);
    }

    let n1 = 0;
    let t1 = 0.5 - x1 * x1 - z1 * z1;
    if (t1 > 0) {
      t1 *= t1;
      const gi1 = permMod12x3[ii + i1 + perm[jj + j1]];
      n1 = t1 * t1 * (GRAD3[gi1] * x1 + GRAD3[gi1 + 1] * z1);
    }

    let n2 = 0;
    let t2 = 0.5 - x2 * x2 - z2 * z2;
    if (t2 > 0) {
      t2 *= t2;
      const gi2 = permMod12x3[ii + 1 + perm[jj + 1]];
      n2 = t2 * t2 * (GRAD3[gi2] * x2 + GRAD3[gi2 + 1] * z2);
    }

    return clampUnit(70 * (n0 + n1 + n2));
  }

  noise3D(x, y, z) {
    const { perm, permMod12x3 } = this;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);

    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1;
    let j1;
    let k1;
    let i2;
    let j2;
    let k2;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let n0 = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      t0 *= t0;
      const gi0 = permMod12x3[ii + perm[jj + perm[kk]]];
      n0 = t0 * t0 * (GRAD3[gi0] * x0 + GRAD3[gi0 + 1] * y0 + GRAD3[gi0 + 2] * z0);
    }

    let n1 = 0;
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      t1 *= t1;
      const gi1 = permMod12x3[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
      n1 = t1 * t1 * (GRAD3[gi1] * x1 + GRAD3[gi1 + 1] * y1 + GRAD3[gi1 + 2] * z1);
    }

    let n2 = 0;
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      t2 *= t2;
      const gi2 = permMod12x3[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
      n2 = t2 * t2 * (GRAD3[gi2] * x2 + GRAD3[gi2 + 1] * y2 + GRAD3[gi2 + 2] * z2);
    }

    let n3 = 0;
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      t3 *= t3;
      const gi3 = permMod12x3[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
      n3 = t3 * t3 * (GRAD3[gi3] * x3 + GRAD3[gi3 + 1] * y3 + GRAD3[gi3 + 2] * z3);
    }

    return clampUnit(32 * (n0 + n1 + n2 + n3));
  }

  fbm2D(x, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    if (octaves <= 0) return 0;
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;

    for (let o = 0; o < octaves; o++) {
      sum += amplitude * this.noise2D(x * frequency, z * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return norm > 0 ? clampUnit(sum / norm) : 0;
  }

  fbm3D(x, y, z, octaves = 3, lacunarity = 2.0, gain = 0.5) {
    if (octaves <= 0) return 0;
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;

    for (let o = 0; o < octaves; o++) {
      sum += amplitude * this.noise3D(x * frequency, y * frequency, z * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return norm > 0 ? clampUnit(sum / norm) : 0;
  }
}
