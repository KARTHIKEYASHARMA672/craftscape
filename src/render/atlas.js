import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, TILE_PX, ATLAS_PX, UV_INSET } from '../core/constants.js';
import { TILE, BLOCK, getBlockDef } from '../core/blocks.js';
import { getItemDef } from '../core/items.js';

const TOTAL_TILES = ATLAS_COLS * ATLAS_ROWS;

/**
 * Compute UV bounding rectangle for an atlas tile index (0..255).
 * Respects Three.js CanvasTexture (flipY = true) so tile row 0 maps to v near 1.0,
 * and applies UV_INSET padding to eliminate sub-texel bleeding between neighbor tiles.
 */
export function getTileUV(tileIndex) {
  const safeIndex = Math.max(0, Math.min(TOTAL_TILES - 1, tileIndex | 0));
  const col = safeIndex % ATLAS_COLS;
  const row = Math.floor(safeIndex / ATLAS_COLS);
  const tileW = 1 / ATLAS_COLS;
  const tileH = 1 / ATLAS_ROWS;

  const u0 = col * tileW + UV_INSET;
  const u1 = (col + 1) * tileW - UV_INSET;
  const v0 = 1 - (row + 1) * tileH + UV_INSET;
  const v1 = 1 - row * tileH - UV_INSET;

  return { u0, v0, u1, v1 };
}

function hash2(x, y, seed = 1) {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1274126177, 2246822519) ^ Math.imul(seed, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hexRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function clampByte(n) {
  return n < 0 ? 0 : n > 255 ? 255 : n | 0;
}

function jitterRgb(rgb, delta) {
  return [clampByte(rgb[0] + delta), clampByte(rgb[1] + delta), clampByte(rgb[2] + delta)];
}

function createPixelSurface(data) {
  function setPx(tileIndex, x, y, r, g, b, a = 255) {
    if (x < 0 || x >= TILE_PX || y < 0 || y >= TILE_PX) return;
    const col = tileIndex % ATLAS_COLS;
    const row = Math.floor(tileIndex / ATLAS_COLS);
    const px = col * TILE_PX + x;
    const py = row * TILE_PX + y;
    const off = (py * ATLAS_PX + px) * 4;
    data[off] = clampByte(r);
    data[off + 1] = clampByte(g);
    data[off + 2] = clampByte(b);
    data[off + 3] = clampByte(a);
  }

  function fillNoise(tileIndex, baseHex, range = 14, seed = 1, alpha = 255) {
    const rgb = hexRgb(baseHex);
    for (let y = 0; y < TILE_PX; y += 1) {
      for (let x = 0; x < TILE_PX; x += 1) {
        const n = (hash2(x, y, seed) - 0.5) * 2 * range;
        setPx(tileIndex, x, y, rgb[0] + n, rgb[1] + n, rgb[2] + n, alpha);
      }
    }
  }

  function fillRect(tileIndex, x0, y0, w, h, hex, jitter = 0, seed = 1, alpha = 255) {
    const rgb = hexRgb(hex);
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const n = jitter ? (hash2(x, y, seed) - 0.5) * 2 * jitter : 0;
        setPx(tileIndex, x, y, rgb[0] + n, rgb[1] + n, rgb[2] + n, alpha);
      }
    }
  }

  function paintClusters(tileIndex, coords, colors, alpha = 255) {
    for (let i = 0; i < coords.length; i += 1) {
      const [x, y, colorIdx = 0] = coords[i];
      const rgb = hexRgb(colors[colorIdx]);
      setPx(tileIndex, x, y, rgb[0], rgb[1], rgb[2], alpha);
    }
  }

  return { setPx, fillNoise, fillRect, paintClusters };
}

function paintStoneAndMinerals(s) {
  // TILE.STONE (0)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const strata = ((y + Math.floor(x / 3)) % 4 === 0) ? -7 : 0;
      const n = (hash2(x, y, 10) - 0.5) * 20 + strata;
      const base = jitterRgb(hexRgb(0x80858b), n);
      s.setPx(TILE.STONE, x, y, base[0], base[1], base[2]);
    }
  }

  // TILE.COBBLESTONE (1) & TILE.MOSSY_COBBLESTONE (56)
  const mortarGrid = [
    '1111011111011110',
    '1221012221012210',
    '1231012321012310',
    '1111011111011110',
    '0000000000000000',
    '1101111101111011',
    '2101223101221012',
    '2101233101231012',
    '1101111101111011',
    '0000000000000000',
    '1111101111011110',
    '1223101221012210',
    '1233101231012310',
    '1111101111011110',
    '0000000000000000',
    '1110111110111110',
  ];
  const cobblePalette = [0x4c5056, 0x6f747a, 0x82878e, 0x989da4];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const code = Number(mortarGrid[y][x]);
      const j = (hash2(x, y, 22) - 0.5) * 12;
      const c = jitterRgb(hexRgb(cobblePalette[code]), j);
      s.setPx(TILE.COBBLESTONE, x, y, c[0], c[1], c[2]);

      const mossChance = hash2(x, y, 560) + (code === 0 ? 0.35 : 0);
      if (mossChance > 0.78) {
        const mc = jitterRgb(hexRgb(mossChance > 0.96 ? 0x6ca34b : 0x4b7d37), j * 0.6);
        s.setPx(TILE.MOSSY_COBBLESTONE, x, y, mc[0], mc[1], mc[2]);
      } else {
        s.setPx(TILE.MOSSY_COBBLESTONE, x, y, c[0], c[1], c[2]);
      }
    }
  }

  // TILE.DIRT (2)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const h = hash2(x, y, 33);
      let hex = 0x875b39;
      if (h > 0.88) hex = 0x6c6763;
      else if (h < 0.25) hex = 0x6b4528;
      else if (h > 0.65) hex = 0x996a44;
      const c = jitterRgb(hexRgb(hex), (hash2(x, y, 34) - 0.5) * 14);
      s.setPx(TILE.DIRT, x, y, c[0], c[1], c[2]);
    }
  }

  // TILE.GRASS_TOP (3)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const h = hash2(x, y, 44);
      const hex = h > 0.72 ? 0x6cb84e : h < 0.24 ? 0x458430 : 0x579e3e;
      const c = jitterRgb(hexRgb(hex), (hash2(x, y, 45) - 0.5) * 12);
      s.setPx(TILE.GRASS_TOP, x, y, c[0], c[1], c[2]);
    }
  }

  // TILE.GRASS_SIDE (4) & TILE.SNOW_GRASS_SIDE (27)
  const overhang = [3, 4, 3, 5, 4, 3, 4, 5, 3, 4, 4, 3, 5, 4, 3, 4];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const dH = hash2(x, y, 33);
      const dHex = dH > 0.88 ? 0x6c6763 : dH < 0.25 ? 0x6b4528 : 0x875b39;
      const dc = jitterRgb(hexRgb(dHex), (hash2(x, y, 34) - 0.5) * 14);
      s.setPx(TILE.GRASS_SIDE, x, y, dc[0], dc[1], dc[2]);
      s.setPx(TILE.SNOW_GRASS_SIDE, x, y, dc[0], dc[1], dc[2]);

      const capDepth = overhang[x];
      if (y < capDepth) {
        const gh = hash2(x, y, 48);
        const gHex = y === 0 ? 0x6cb84e : gh < 0.3 ? 0x44822e : 0x559c3c;
        const gc = jitterRgb(hexRgb(gHex), (gh - 0.5) * 10);
        s.setPx(TILE.GRASS_SIDE, x, y, gc[0], gc[1], gc[2]);

        const sc = jitterRgb(hexRgb(y === 0 ? 0xf7fbfe : y === capDepth - 1 ? 0xd0e2ef : 0xebf4fa), (gh - 0.5) * 8);
        s.setPx(TILE.SNOW_GRASS_SIDE, x, y, sc[0], sc[1], sc[2]);
      } else if (y === capDepth) {
        s.setPx(TILE.GRASS_SIDE, x, y, dc[0] * 0.78, dc[1] * 0.78, dc[2] * 0.78);
        s.setPx(TILE.SNOW_GRASS_SIDE, x, y, dc[0] * 0.82, dc[1] * 0.84, dc[2] * 0.9);
      }
    }
  }

  // TILE.SAND (5)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const wave = Math.sin((x * 0.45 + y * 0.9)) * 7;
      const h = (hash2(x, y, 55) - 0.5) * 16 + wave;
      const c = jitterRgb(hexRgb(0xdfd094), h);
      s.setPx(TILE.SAND, x, y, c[0], c[1], c[2]);
    }
  }

  // TILE.SANDSTONE_TOP (6) & TILE.SANDSTONE_SIDE (7)
  s.fillNoise(TILE.SANDSTONE_TOP, 0xd9c68a, 10, 60);
  for (let i = 0; i < 16; i += 1) {
    s.setPx(TILE.SANDSTONE_TOP, i, 0, 232, 214, 156);
    s.setPx(TILE.SANDSTONE_TOP, 0, i, 232, 214, 156);
    s.setPx(TILE.SANDSTONE_TOP, i, 15, 184, 165, 112);
    s.setPx(TILE.SANDSTONE_TOP, 15, i, 184, 165, 112);
  }
  s.fillNoise(TILE.SANDSTONE_SIDE, 0xd4bf81, 10, 61);
  s.fillRect(TILE.SANDSTONE_SIDE, 0, 0, 16, 4, 0xdfd096, 8, 62);
  s.fillRect(TILE.SANDSTONE_SIDE, 0, 4, 16, 1, 0xb39d62, 4, 63);
  s.fillRect(TILE.SANDSTONE_SIDE, 0, 11, 16, 1, 0xb39d62, 4, 64);
  s.fillRect(TILE.SANDSTONE_SIDE, 7, 5, 1, 6, 0xb39d62, 4, 65);
  s.fillRect(TILE.SANDSTONE_SIDE, 15, 5, 1, 6, 0xb39d62, 4, 66);
  s.fillRect(TILE.SANDSTONE_SIDE, 3, 12, 1, 4, 0xb39d62, 4, 67);
  s.fillRect(TILE.SANDSTONE_SIDE, 11, 12, 1, 4, 0xb39d62, 4, 68);

  // TILE.GRAVEL (8)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const h = hash2(x, y, 80);
      const hex = h > 0.75 ? 0xa59f9b : h < 0.25 ? 0x5c5856 : h < 0.55 ? 0x7a7571 : 0x8f8a85;
      const c = jitterRgb(hexRgb(hex), (hash2(x, y, 81) - 0.5) * 10);
      s.setPx(TILE.GRAVEL, x, y, c[0], c[1], c[2]);
    }
  }

  // TILE.CLAY (9)
  s.fillNoise(TILE.CLAY, 0x9ea6b6, 11, 90);
  s.fillRect(TILE.CLAY, 2, 3, 5, 3, 0xaeb6c5, 6, 91);
  s.fillRect(TILE.CLAY, 9, 9, 5, 4, 0x8f97a8, 6, 92);

  // TILE.BEDROCK (10)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const h = hash2(x, y, 100);
      const hex = h > 0.78 ? 0x52555f : h < 0.35 ? 0x121317 : 0x2d3038;
      const c = hexRgb(hex);
      s.setPx(TILE.BEDROCK, x, y, c[0], c[1], c[2]);
    }
  }

  // TILE.SNOW (15)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const h = hash2(x, y, 150);
      const hex = h > 0.78 ? 0xffffff : h < 0.22 ? 0xdde9f2 : 0xf2f7fb;
      const c = hexRgb(hex);
      s.setPx(TILE.SNOW, x, y, c[0], c[1], c[2]);
    }
  }

  // Ores (copy stone base then paint rich faceted flecks)
  const copyStoneTo = (targetTile) => {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const strata = ((y + Math.floor(x / 3)) % 4 === 0) ? -7 : 0;
        const n = (hash2(x, y, 10) - 0.5) * 20 + strata;
        const base = jitterRgb(hexRgb(0x80858b), n);
        s.setPx(targetTile, x, y, base[0], base[1], base[2]);
      }
    }
  };
  const oreFlecks = [
    [2, 3, 0], [3, 3, 1], [3, 4, 0], [4, 4, 2],
    [10, 2, 0], [11, 2, 1], [11, 3, 0], [12, 3, 2],
    [5, 8, 0], [6, 8, 1], [6, 9, 0], [7, 9, 2],
    [11, 10, 0], [12, 10, 1], [12, 11, 2], [11, 11, 0],
    [3, 12, 0], [4, 12, 1], [4, 13, 2],
  ];
  copyStoneTo(TILE.COAL_ORE);
  s.paintClusters(TILE.COAL_ORE, oreFlecks, [0x212327, 0x35383f, 0x131417]);

  copyStoneTo(TILE.IRON_ORE);
  s.paintClusters(TILE.IRON_ORE, oreFlecks, [0xd4aa87, 0xf0cdb0, 0xa37858]);

  copyStoneTo(TILE.GOLD_ORE);
  s.paintClusters(TILE.GOLD_ORE, oreFlecks, [0xf5ce38, 0xfff085, 0xc79218]);

  copyStoneTo(TILE.DIAMOND_ORE);
  s.paintClusters(TILE.DIAMOND_ORE, oreFlecks, [0x4beae0, 0x99fbf5, 0x24b2aa]);

  copyStoneTo(TILE.EMERALD_ORE);
  s.paintClusters(TILE.EMERALD_ORE, oreFlecks, [0x2ed15e, 0x7ef59e, 0x1a913e]);

  copyStoneTo(TILE.REDSTONE_ORE);
  s.paintClusters(TILE.REDSTONE_ORE, oreFlecks, [0xe02828, 0xff6e6e, 0x991212]);
}

function paintWoodAndFoliage(s) {
  const paintLog = (sideTile, topTile, barkA, barkB, heartA, heartB, birchDashes = false) => {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const ridge = (x % 3 === 0) ? barkB : barkA;
        const n = (hash2(x, y, sideTile + 200) - 0.5) * 14;
        const c = jitterRgb(hexRgb(ridge), n);
        s.setPx(sideTile, x, y, c[0], c[1], c[2]);
        if (birchDashes && ((y === 3 && x >= 2 && x <= 5) || (y === 8 && x >= 9 && x <= 13) || (y === 12 && x >= 4 && x <= 8) || (y === 6 && x >= 1 && x <= 3))) {
          s.setPx(sideTile, x, y, 52, 52, 54);
        }
      }
    }
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const dist = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let hex = heartA;
        if (dist > 6.4) hex = barkB;
        else if (dist > 4.2 && dist < 5.3) hex = heartB;
        else if (dist > 1.8 && dist < 2.9) hex = heartB;
        const c = jitterRgb(hexRgb(hex), (hash2(x, y, topTile + 300) - 0.5) * 10);
        s.setPx(topTile, x, y, c[0], c[1], c[2]);
      }
    }
  };

  paintLog(TILE.OAK_LOG_SIDE, TILE.OAK_LOG_TOP, 0x6b4c2d, 0x52371d, 0xbe9562, 0x9e7545, false);
  paintLog(TILE.BIRCH_LOG_SIDE, TILE.BIRCH_LOG_TOP, 0xe3e0d6, 0xcac6bb, 0xdcc997, 0xbca674, true);
  paintLog(TILE.SPRUCE_LOG_SIDE, TILE.SPRUCE_LOG_TOP, 0x462e1b, 0x311f11, 0xa87c4f, 0x875f37, false);

  const paintPlanks = (tile, baseHex, seamHex, hiHex) => {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const band = Math.floor(y / 4);
        const isSeam = y % 4 === 0 || (band % 2 === 0 && x === 7) || (band % 2 === 1 && x === 15);
        const isHi = y % 4 === 1;
        const hex = isSeam ? seamHex : isHi ? hiHex : baseHex;
        const grain = ((x + band * 5) % 6 === 0) ? -8 : 0;
        const n = (hash2(x, y, tile + 400) - 0.5) * 10 + grain;
        const c = jitterRgb(hexRgb(hex), n);
        s.setPx(tile, x, y, c[0], c[1], c[2]);
      }
    }
  };
  paintPlanks(TILE.OAK_PLANKS, 0xb58852, 0x7b562e, 0xc99c63);
  paintPlanks(TILE.BIRCH_PLANKS, 0xdac695, 0xa8925e, 0xead8a9);

  const paintLeaves = (tile, darkHex, midHex, lightHex, seed) => {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const h = hash2(x, y, seed);
        if (h < 0.22) {
          s.setPx(tile, x, y, 0, 0, 0, 0);
        } else {
          const hex = h > 0.78 ? lightHex : h < 0.44 ? darkHex : midHex;
          const c = jitterRgb(hexRgb(hex), (hash2(x, y, seed + 1) - 0.5) * 14);
          s.setPx(tile, x, y, c[0], c[1], c[2], 255);
        }
      }
    }
  };
  paintLeaves(TILE.OAK_LEAVES, 0x2a6123, 0x3d8233, 0x5ca84d, 501);
  paintLeaves(TILE.BIRCH_LEAVES, 0x457330, 0x5d9442, 0x7eb560, 505);
  paintLeaves(TILE.SPRUCE_LEAVES, 0x1e402e, 0x2c5942, 0x3f7559, 509);

  // Cactus
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const rib = x % 4 === 0 ? 0x28612a : x % 4 === 2 ? 0x459446 : 0x367d38;
      const spine = (x % 4 === 1 && y % 4 === 2);
      const c = spine ? hexRgb(0xdbe8c5) : jitterRgb(hexRgb(rib), (hash2(x, y, 601) - 0.5) * 10);
      s.setPx(TILE.CACTUS_SIDE, x, y, c[0], c[1], c[2]);

      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const topHex = d > 5.8 ? 0x28612a : d < 2.2 ? 0x57ad58 : 0x3c873e;
      const tc = jitterRgb(hexRgb(topHex), (hash2(x, y, 602) - 0.5) * 8);
      s.setPx(TILE.CACTUS_TOP, x, y, tc[0], tc[1], tc[2]);
    }
  }

  // Transparent cross plants (TALL_GRASS=30, POPPY=31, DANDELION=32)
  s.fillRect(TILE.TALL_GRASS, 0, 0, 16, 16, 0x000000, 0, 1, 0);
  const blades = [
    [2, 5, 0x458b35], [3, 4, 0x5cae47], [4, 7, 0x3b7a2d],
    [6, 3, 0x62b84c], [7, 2, 0x4d993b], [9, 5, 0x5cae47],
    [10, 3, 0x458b35], [12, 6, 0x62b84c], [13, 4, 0x3b7a2d],
  ];
  for (const [bx, topY, hex] of blades) {
    for (let y = topY; y < 16; y += 1) {
      const sway = y < 8 && bx % 2 === 0 ? -1 : y < 7 ? 1 : 0;
      const c = jitterRgb(hexRgb(hex), (15 - y) * 1.4);
      s.setPx(TILE.TALL_GRASS, bx + sway, y, c[0], c[1], c[2], 255);
    }
  }

  // POPPY
  s.fillRect(TILE.POPPY, 0, 0, 16, 16, 0x000000, 0, 1, 0);
  for (let y = 7; y < 16; y += 1) {
    s.setPx(TILE.POPPY, 7, y, 62, 132, 48, 255);
    s.setPx(TILE.POPPY, 8, y, 50, 108, 39, 255);
  }
  s.fillRect(TILE.POPPY, 5, 11, 2, 2, 0x459437, 0, 1, 255);
  s.fillRect(TILE.POPPY, 9, 10, 2, 2, 0x459437, 0, 1, 255);
  s.fillRect(TILE.POPPY, 5, 3, 6, 5, 0xdc3226, 10, 710, 255);
  s.fillRect(TILE.POPPY, 6, 2, 4, 1, 0xf25244, 0, 1, 255);
  s.fillRect(TILE.POPPY, 7, 4, 2, 2, 0x281818, 0, 1, 255);

  // DANDELION
  s.fillRect(TILE.DANDELION, 0, 0, 16, 16, 0x000000, 0, 1, 0);
  for (let y = 8; y < 16; y += 1) {
    s.setPx(TILE.DANDELION, 7, y, 68, 140, 52, 255);
    s.setPx(TILE.DANDELION, 8, y, 54, 115, 42, 255);
  }
  s.fillRect(TILE.DANDELION, 5, 12, 2, 2, 0x4c9c3d, 0, 1, 255);
  s.fillRect(TILE.DANDELION, 9, 11, 2, 2, 0x4c9c3d, 0, 1, 255);
  s.fillRect(TILE.DANDELION, 5, 4, 6, 4, 0xf6d531, 10, 720, 255);
  s.fillRect(TILE.DANDELION, 6, 3, 4, 2, 0xfff06e, 0, 1, 255);
}

function paintFluidsAndGlass(s) {
  // WATER (11) - translucent (alpha 200 ~ 0.78)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const ripple = Math.sin((x + y * 2) * 0.65) * 14;
      const hi = ((x + y) % 7 === 0 && hash2(x, y, 811) > 0.55) ? 28 : 0;
      const c = jitterRgb(hexRgb(0x2e7dd9), ripple + hi);
      s.setPx(TILE.WATER, x, y, c[0], c[1], c[2], 200);
    }
  }

  // LAVA (12) - opaque glowing molten magma
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const h = hash2(x, y, 812);
      const cell = Math.sin(x * 0.8) * Math.cos(y * 0.8);
      let hex = 0xf05c14;
      if (cell > 0.35 || h > 0.82) hex = 0xffcb3d;
      else if (cell < -0.35 || h < 0.16) hex = 0xa8250a;
      const c = jitterRgb(hexRgb(hex), (h - 0.5) * 18);
      s.setPx(TILE.LAVA, x, y, c[0], c[1], c[2], 255);
    }
  }

  // GLASS (13) - clear cutout interior + crisp cyan border + reflection streaks
  s.fillRect(TILE.GLASS, 0, 0, 16, 16, 0x000000, 0, 1, 0);
  for (let i = 0; i < 16; i += 1) {
    s.setPx(TILE.GLASS, i, 0, 184, 232, 245, 255);
    s.setPx(TILE.GLASS, i, 15, 162, 214, 232, 255);
    s.setPx(TILE.GLASS, 0, i, 184, 232, 245, 255);
    s.setPx(TILE.GLASS, 15, i, 162, 214, 232, 255);
  }
  const glare = [[2, 3], [3, 2], [2, 4], [4, 2], [11, 13], [12, 12], [13, 11]];
  for (const [gx, gy] of glare) {
    s.setPx(TILE.GLASS, gx, gy, 234, 250, 255, 255);
  }

  // ICE (14) - frosted translucent blue (alpha 196)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const streak = ((x + y) % 8 === 0) ? 24 : 0;
      const c = jitterRgb(hexRgb(0x88c7f7), streak + (hash2(x, y, 814) - 0.5) * 12);
      s.setPx(TILE.ICE, x, y, c[0], c[1], c[2], 196);
    }
  }
}

function paintCraftedAndSpecial(s) {
  // CRAFTING_TOP (39)
  s.fillNoise(TILE.CRAFTING_TOP, 0xa87a46, 8, 900);
  s.fillRect(TILE.CRAFTING_TOP, 0, 0, 16, 2, 0x6b4723, 4, 901);
  s.fillRect(TILE.CRAFTING_TOP, 0, 14, 16, 2, 0x6b4723, 4, 902);
  s.fillRect(TILE.CRAFTING_TOP, 0, 0, 2, 16, 0x6b4723, 4, 903);
  s.fillRect(TILE.CRAFTING_TOP, 14, 0, 2, 16, 0x6b4723, 4, 904);
  for (const line of [5, 10]) {
    s.fillRect(TILE.CRAFTING_TOP, 2, line, 12, 1, 0x4f3216);
    s.fillRect(TILE.CRAFTING_TOP, line, 2, 1, 12, 0x4f3216);
  }

  // CRAFTING_SIDE (40)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const isBorder = x < 2 || x > 13 || y < 2 || y > 13;
      const c = jitterRgb(hexRgb(isBorder ? 0x6b4723 : 0xb3844e), (hash2(x, y, 910) - 0.5) * 10);
      s.setPx(TILE.CRAFTING_SIDE, x, y, c[0], c[1], c[2]);
    }
  }
  // Tool silhouettes (saw & hammer)
  s.fillRect(TILE.CRAFTING_SIDE, 4, 4, 2, 7, 0x9aa2ad);
  s.fillRect(TILE.CRAFTING_SIDE, 4, 3, 3, 2, 0x5c3c1e);
  s.fillRect(TILE.CRAFTING_SIDE, 9, 4, 4, 2, 0x8a929c);
  s.fillRect(TILE.CRAFTING_SIDE, 10, 6, 2, 6, 0x5c3c1e);

  // FURNACE_TOP (43), FURNACE_SIDE (42), FURNACE_FRONT (41)
  s.fillNoise(TILE.FURNACE_TOP, 0x6f737a, 10, 920);
  for (let i = 0; i < 16; i += 1) {
    s.setPx(TILE.FURNACE_TOP, i, 0, 140, 144, 150);
    s.setPx(TILE.FURNACE_TOP, i, 15, 72, 75, 80);
  }
  s.fillNoise(TILE.FURNACE_SIDE, 0x666a70, 10, 921);
  s.fillRect(TILE.FURNACE_SIDE, 0, 7, 16, 1, 0x45484d);
  s.fillRect(TILE.FURNACE_SIDE, 7, 0, 1, 7, 0x45484d);
  s.fillRect(TILE.FURNACE_SIDE, 15, 8, 1, 8, 0x45484d);

  s.fillNoise(TILE.FURNACE_FRONT, 0x6c7076, 10, 922);
  s.fillRect(TILE.FURNACE_FRONT, 3, 3, 10, 4, 0x202226);
  s.fillRect(TILE.FURNACE_FRONT, 4, 9, 8, 5, 0x1a1b1f);
  s.fillRect(TILE.FURNACE_FRONT, 5, 12, 6, 2, 0xd45a1e, 16, 923);
  s.fillRect(TILE.FURNACE_FRONT, 6, 13, 4, 1, 0xffc342);

  // CHEST_TOP (46), CHEST_SIDE (45), CHEST_FRONT (44)
  const paintChestBase = (tile, seed) => {
    s.fillNoise(tile, 0xa67437, 8, seed);
    s.fillRect(tile, 0, 0, 16, 1, 0x4f3314);
    s.fillRect(tile, 0, 15, 16, 1, 0x4f3314);
    s.fillRect(tile, 0, 0, 1, 16, 0x4f3314);
    s.fillRect(tile, 15, 0, 1, 16, 0x4f3314);
  };
  paintChestBase(TILE.CHEST_TOP, 930);
  paintChestBase(TILE.CHEST_SIDE, 931);
  s.fillRect(TILE.CHEST_SIDE, 0, 5, 16, 1, 0x422a0f);
  paintChestBase(TILE.CHEST_FRONT, 932);
  s.fillRect(TILE.CHEST_FRONT, 0, 5, 16, 1, 0x422a0f);
  s.fillRect(TILE.CHEST_FRONT, 7, 4, 2, 3, 0xdce1e8);
  s.setPx(TILE.CHEST_FRONT, 7, 4, 245, 248, 252);

  // TORCH (47) & TORCH_FLAME (62)
  s.fillRect(TILE.TORCH, 0, 0, 16, 16, 0x000000, 0, 1, 0);
  for (let y = 8; y < 16; y += 1) {
    s.setPx(TILE.TORCH, 7, y, 146, 102, 52, 255);
    s.setPx(TILE.TORCH, 8, y, 114, 76, 36, 255);
  }
  // Glowing tip at y=6..7 inside x=7..8 so both 2D sprite & 3D post map crisply
  s.setPx(TILE.TORCH, 7, 7, 255, 162, 36, 255);
  s.setPx(TILE.TORCH, 8, 7, 255, 186, 52, 255);
  s.setPx(TILE.TORCH, 7, 6, 255, 245, 178, 255);
  s.setPx(TILE.TORCH, 8, 6, 255, 224, 112, 255);
  s.setPx(TILE.TORCH, 7, 5, 255, 252, 214, 255);

  // TORCH_FLAME (62)
  s.fillNoise(TILE.TORCH_FLAME, 0xffaa2b, 18, 940);
  s.fillRect(TILE.TORCH_FLAME, 3, 3, 10, 10, 0xffe46b, 12, 941);
  s.fillRect(TILE.TORCH_FLAME, 6, 6, 4, 4, 0xfffce0);

  // BRICKS (48)
  s.fillNoise(TILE.BRICKS, 0xc7c2ba, 5, 950);
  for (let row = 0; row < 4; row += 1) {
    const y0 = row * 4;
    const shift = (row % 2) * 4;
    for (let x = 0; x < 16; x += 1) {
      const isVertMortar = ((x + shift) % 8 === 0);
      if (!isVertMortar) {
        for (let dy = 0; dy < 3; dy += 1) {
          const c = jitterRgb(hexRgb(0xa1493a), (hash2(x, y0 + dy, 951) - 0.5) * 20);
          s.setPx(TILE.BRICKS, x, y0 + dy, c[0], c[1], c[2]);
        }
      }
    }
  }

  // BOOKSHELF_SIDE (49)
  s.fillNoise(TILE.BOOKSHELF_SIDE, 0x3b2615, 6, 960);
  s.fillRect(TILE.BOOKSHELF_SIDE, 0, 0, 16, 2, 0xb58852, 8, 961);
  s.fillRect(TILE.BOOKSHELF_SIDE, 0, 7, 16, 2, 0xb58852, 8, 962);
  s.fillRect(TILE.BOOKSHELF_SIDE, 0, 14, 16, 2, 0xb58852, 8, 963);
  const bookColors = [0xc43b31, 0x2f6cb5, 0x458f48, 0xd4a438, 0xe8dec8, 0x8f4099];
  for (let shelf = 0; shelf < 2; shelf += 1) {
    const sy = shelf === 0 ? 2 : 9;
    let bx = 1;
    let bi = shelf * 3;
    while (bx < 15) {
      const w = (bx % 3 === 0) ? 1 : 2;
      const bh = 4 + (bi % 2);
      const colHex = bookColors[bi % bookColors.length];
      s.fillRect(TILE.BOOKSHELF_SIDE, bx, sy + (5 - bh), w, bh, colHex);
      s.fillRect(TILE.BOOKSHELF_SIDE, bx, sy + (5 - bh) + 1, w, 1, 0xf2ead7);
      bx += w + 1;
      bi += 1;
    }
  }

  // TNT_SIDE (50) & TNT_TOP (51)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const stripe = (x % 3 === 0) ? 0xb52b20 : 0xdb4134;
      const c = jitterRgb(hexRgb(stripe), (hash2(x, y, 970) - 0.5) * 10);
      s.setPx(TILE.TNT_SIDE, x, y, c[0], c[1], c[2]);
    }
  }
  s.fillRect(TILE.TNT_SIDE, 0, 5, 16, 6, 0xf2efe6, 4, 971);
  // Crisp pixel letters "T N T" at y = 6..9
  const tntGlyphs = [
    [1, 6], [2, 6], [3, 6], [2, 7], [2, 8], [2, 9],
    [6, 6], [6, 7], [6, 8], [6, 9], [7, 7], [8, 8], [9, 6], [9, 7], [9, 8], [9, 9],
    [12, 6], [13, 6], [14, 6], [13, 7], [13, 8], [13, 9],
  ];
  for (const [gx, gy] of tntGlyphs) {
    s.setPx(TILE.TNT_SIDE, gx, gy, 24, 26, 31);
  }
  s.fillNoise(TILE.TNT_TOP, 0xc73428, 14, 972);
  s.fillRect(TILE.TNT_TOP, 6, 6, 4, 4, 0x26262a);
  s.fillRect(TILE.TNT_TOP, 7, 7, 2, 2, 0x525259);

  // GLOWSTONE (52)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const h = hash2(x, y, 980);
      const hex = h > 0.72 ? 0xfff3b0 : h < 0.2 ? 0x9c601c : 0xf2c355;
      const c = jitterRgb(hexRgb(hex), (hash2(x, y, 981) - 0.5) * 14);
      s.setPx(TILE.GLOWSTONE, x, y, c[0], c[1], c[2]);
    }
  }

  // OBSIDIAN (53)
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const h = hash2(x, y, 985);
      const hex = h > 0.8 ? 0x452f66 : h < 0.25 ? 0x0f0b17 : 0x241936;
      const c = jitterRgb(hexRgb(hex), (h - 0.5) * 10);
      s.setPx(TILE.OBSIDIAN, x, y, c[0], c[1], c[2]);
    }
  }

  // WOOL_WHITE (54) & WOOL_RED (55)
  s.fillNoise(TILE.WOOL_WHITE, 0xedece6, 9, 990);
  s.fillNoise(TILE.WOOL_RED, 0xb83030, 11, 991);

  // STONE_BRICKS (57)
  s.fillNoise(TILE.STONE_BRICKS, 0x7a7f86, 9, 995);
  s.fillRect(TILE.STONE_BRICKS, 0, 0, 16, 1, 0x565a61);
  s.fillRect(TILE.STONE_BRICKS, 0, 8, 16, 1, 0x565a61);
  s.fillRect(TILE.STONE_BRICKS, 7, 0, 1, 8, 0x565a61);
  s.fillRect(TILE.STONE_BRICKS, 15, 8, 1, 8, 0x565a61);

  // TERRACOTTA (58)
  s.fillNoise(TILE.TERRACOTTA, 0xa85a42, 10, 996);

  // Metallic/Gem Blocks (GOLD=59, DIAMOND=60, IRON=61)
  const paintMetalBlock = (tile, bodyHex, lightHex, darkHex, seed) => {
    s.fillNoise(tile, bodyHex, 8, seed);
    for (let i = 0; i < 16; i += 1) {
      const l = hexRgb(lightHex);
      const d = hexRgb(darkHex);
      s.setPx(tile, i, 0, l[0], l[1], l[2]);
      s.setPx(tile, 0, i, l[0], l[1], l[2]);
      s.setPx(tile, i, 15, d[0], d[1], d[2]);
      s.setPx(tile, 15, i, d[0], d[1], d[2]);
      if (i >= 2 && i <= 13) {
        s.setPx(tile, i, 2, d[0], d[1], d[2]);
        s.setPx(tile, 2, i, d[0], d[1], d[2]);
        s.setPx(tile, i, 13, l[0], l[1], l[2]);
        s.setPx(tile, 13, i, l[0], l[1], l[2]);
      }
    }
  };
  paintMetalBlock(TILE.GOLD_BLOCK, 0xf2c93d, 0xfff08a, 0xc28f17, 1001);
  paintMetalBlock(TILE.DIAMOND_BLOCK, 0x4fdad1, 0xa6fcf6, 0x25a199, 1002);
  paintMetalBlock(TILE.IRON_BLOCK, 0xd4d8de, 0xf2f5f9, 0x9aa0a8, 1003);
}

/**
 * Paint the complete 256x256 procedural 16x16 pixel-art texture atlas onto an HTMLCanvasElement.
 * Returns null if invoked in a headless environment without document.
 */
export function createAtlasCanvas() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(ATLAS_PX, ATLAS_PX);
  const surface = createPixelSurface(imgData.data);

  paintStoneAndMinerals(surface);
  paintWoodAndFoliage(surface);
  paintFluidsAndGlass(surface);
  paintCraftedAndSpecial(surface);

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Wrap the procedural 256x256 canvas atlas in a crisp NearestFilter Three.js CanvasTexture.
 */
export function createAtlasTexture() {
  const canvas = createAtlasCanvas();
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create shared shader uniforms for opaque, cutout, and translucent chunk passes.
 */
export function createChunkUniforms(atlasTexture) {
  return {
    uMap: { value: atlasTexture },
    uSunIntensity: { value: 1.0 },
    uFogColor: { value: new THREE.Color(0xaed6ff) },
    uFogNear: { value: 48.0 },
    uFogFar: { value: 96.0 },
    uUnderwater: { value: 0.0 },
    uTime: { value: 0.0 },
  };
}

const CHUNK_VERTEX_SHADER = /* glsl */ `
  attribute vec2 aLight;
  uniform float uTime;
  uniform bool uIsWaterPass;
  varying vec2 vUv;
  varying vec3 vShade;
  varying vec2 vLight;
  varying float vFogDepth;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vShade = color;
    vLight = aLight;

    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    if (uIsWaterPass && normal.y > 0.5 && uv.y > 0.9375 && uv.x < 0.8125) {
      float wave = sin(worldPosition.x * 1.7 + uTime * 2.3) * cos(worldPosition.z * 1.5 + uTime * 1.9);
      worldPosition.y += wave * 0.025;
    }
    vWorldPos = worldPosition.xyz;

    vec4 mvPosition = viewMatrix * worldPosition;
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const CHUNK_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uSunIntensity;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uUnderwater;
  uniform float uTime;
  uniform float uAlphaTest;
  uniform bool uIsWaterPass;

  varying vec2 vUv;
  varying vec3 vShade;
  varying vec2 vLight;
  varying float vFogDepth;
  varying vec3 vWorldPos;

  void main() {
    vec4 texColor = texture2D(uMap, vUv);
    if (uAlphaTest > 0.0 && texColor.a < uAlphaTest) {
      discard;
    }

    float sky = pow(clamp(vLight.x * uSunIntensity, 0.0, 1.0), 1.3);
    float block = pow(clamp(vLight.y, 0.0, 1.0), 1.45);
    vec3 skyTint = mix(vec3(0.55, 0.66, 0.95), vec3(1.0, 0.99, 0.96), smoothstep(0.18, 0.8, uSunIntensity));
    vec3 blockTint = vec3(1.0, 0.83, 0.56);
    vec3 lightRGB = max(vec3(0.03), max(skyTint * sky, blockTint * block));

    vec3 rgb = texColor.rgb * vShade * lightRGB;

    if (uIsWaterPass && vUv.y > 0.9375 && vUv.x < 0.8125) {
      float shimmer = 0.95 + 0.07 * sin(vWorldPos.x * 2.2 + vWorldPos.z * 2.0 + uTime * 3.1);
      rgb *= shimmer;
    }

    if (uUnderwater > 0.01) {
      rgb = mix(rgb, rgb * vec3(0.55, 0.80, 1.0), uUnderwater * 0.55);
    }

    float fogFactor = smoothstep(uFogNear, max(uFogNear + 1.0, uFogFar), vFogDepth);
    vec3 finalFog = mix(uFogColor, vec3(0.0036, 0.0452, 0.1329), uUnderwater);
    rgb = mix(rgb, finalFog, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(rgb, texColor.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Create a single chunk ShaderMaterial supporting AO vertex colors, dual sky/block light,
 * fog, underwater tint, alpha cutoff, and water animation.
 */
export function createChunkMaterial(atlasTexture, { transparent = false, cutout = false, uniforms = null } = {}) {
  const baseUniforms = uniforms ?? createChunkUniforms(atlasTexture);
  const materialUniforms = {
    ...baseUniforms,
    uAlphaTest: { value: cutout ? 0.45 : 0.0 },
    uIsWaterPass: { value: transparent },
  };

  return new THREE.ShaderMaterial({
    uniforms: materialUniforms,
    vertexShader: CHUNK_VERTEX_SHADER,
    fragmentShader: CHUNK_FRAGMENT_SHADER,
    vertexColors: true,
    transparent,
    depthWrite: !transparent,
    side: transparent || cutout ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/**
 * Create coordinated opaque, cutout, and water/translucent materials sharing a single uniform set.
 */
export function createChunkMaterials(atlasTexture) {
  const uniforms = createChunkUniforms(atlasTexture);
  return {
    opaqueMaterial: createChunkMaterial(atlasTexture, { transparent: false, cutout: false, uniforms }),
    cutoutMaterial: createChunkMaterial(atlasTexture, { transparent: false, cutout: true, uniforms }),
    waterMaterial: createChunkMaterial(atlasTexture, { transparent: true, cutout: false, uniforms }),
    uniforms,
  };
}

// ---------- Item Icon Rendering (Isometric 3D Block & Pixel-Art Sprite Cache) ----------

let cachedAtlasCanvas = null;
const iconCache = new Map();

function getSharedAtlasCanvas() {
  if (!cachedAtlasCanvas) {
    cachedAtlasCanvas = createAtlasCanvas();
  }
  return cachedAtlasCanvas;
}

function getShadedTileCanvas(atlas, tileIndex, darkenAlpha) {
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = TILE_PX;
  tileCanvas.height = TILE_PX;
  const ctx = tileCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const col = tileIndex % ATLAS_COLS;
  const row = Math.floor(tileIndex / ATLAS_COLS);
  ctx.drawImage(atlas, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);

  if (darkenAlpha > 0) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0, 0, 0, ${darkenAlpha})`;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  }
  return tileCanvas;
}

function drawIsometricBlockIcon(ctx, atlas, def, size) {
  const topTile = getShadedTileCanvas(atlas, def.tiles.top, 0);
  const leftTile = getShadedTileCanvas(atlas, def.tiles.north, 0.16);
  const rightTile = getShadedTileCanvas(atlas, def.tiles.east, 0.34);

  const scaleShrink = def.renderType === 'cactus' ? 0.88 : 1.0;
  const dx = size * 0.38 * scaleShrink;
  const dy = dx * 0.5;
  const h = dx * 1.15;
  const mx = size * 0.5;
  const my = size * 0.5 - (h - 2 * dy) * 0.5;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Top face
  ctx.setTransform(dx / TILE_PX, dy / TILE_PX, -dx / TILE_PX, dy / TILE_PX, mx, my - 2 * dy);
  ctx.drawImage(topTile, 0, 0);

  // Left (front/north) face
  ctx.setTransform(dx / TILE_PX, dy / TILE_PX, 0, h / TILE_PX, mx - dx, my - dy);
  ctx.drawImage(leftTile, 0, 0);

  // Right (side/east) face
  ctx.setTransform(dx / TILE_PX, -dy / TILE_PX, 0, h / TILE_PX, mx, my);
  ctx.drawImage(rightTile, 0, 0);

  ctx.restore();
}

function drawPixelGrid(ctx16, pixels, palette) {
  for (let y = 0; y < pixels.length; y += 1) {
    const row = pixels[y];
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x];
      if (ch === '.') continue;
      ctx16.fillStyle = palette[ch] ?? '#ffffff';
      ctx16.fillRect(x, y, 1, 1);
    }
  }
}

function buildToolPalette(headHex) {
  const rgb = hexRgb(parseInt(headHex.slice(1), 16));
  const hi = `rgb(${clampByte(rgb[0] + 38)},${clampByte(rgb[1] + 38)},${clampByte(rgb[2] + 38)})`;
  const mid = headHex;
  const dark = `rgb(${clampByte(rgb[0] - 42)},${clampByte(rgb[1] - 42)},${clampByte(rgb[2] - 42)})`;
  return {
    H: hi,
    M: mid,
    D: dark,
    W: '#9c7143',
    B: '#6e4924',
  };
}

const TOOL_SPRITES = {
  pickaxe: [
    '................',
    '......HHHHH.....',
    '.....HMMMMMD....',
    '....HM....WMD...',
    '..........W.MD..',
    '.........W..MD..',
    '........W....D..',
    '.......B........',
    '......W.........',
    '.....B..........',
    '....W...........',
    '...B............',
    '..W.............',
    '.B..............',
    '................',
    '................',
  ],
  axe: [
    '................',
    '.......HHH......',
    '......HMMMD.....',
    '.....HMMWMD.....',
    '.....HMDW.......',
    '......DW........',
    '.......B........',
    '......W.........',
    '.....B..........',
    '....W...........',
    '...B............',
    '..W.............',
    '.B..............',
    '................',
    '................',
    '................',
  ],
  shovel: [
    '................',
    '..........HHHH..',
    '.........HMMMD..',
    '.........HMMMD..',
    '........WMMMMD..',
    '.......B.DDDD...',
    '......W.........',
    '.....B..........',
    '....W...........',
    '...B............',
    '..W.............',
    '.B..............',
    '................',
    '................',
    '................',
    '................',
  ],
  sword: [
    '................',
    '............HH..',
    '...........HMMH.',
    '..........HMMD..',
    '.........HMMD...',
    '........HMMD....',
    '.......HMMD.....',
    '..DD..HMMD......',
    '...DDHMMD.......',
    '....DBBD........',
    '...W.DD.........',
    '..B.............',
    '.W..............',
    '................',
    '................',
    '................',
  ],
};

const MATERIAL_SPRITES = {
  stick: [
    '................',
    '............HH..',
    '...........HMD..',
    '..........HMD...',
    '.........HMD....',
    '........HMD.....',
    '.......HMD......',
    '......HMD.......',
    '.....HMD........',
    '....HMD.........',
    '...HMD..........',
    '..MD............',
    '................',
    '................',
    '................',
    '................',
  ],
  ingot: [
    '................',
    '................',
    '................',
    '.....HHHHHH.....',
    '....HMMMMMMH....',
    '...HMMMMMMMMD...',
    '..HMMMMMMMMDDD..',
    '..MMMMMMMMDDDD..',
    '..DDDDDDDDDDD...',
    '...DDDDDDDDD....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  diamond: [
    '................',
    '................',
    '......HHHH......',
    '....HHMMMMHH....',
    '...HMMMMMMMMD...',
    '..HMMHHMMMMMMD..',
    '..HMHHMMMMMMMD..',
    '..HMMMMMMMMMMD..',
    '...DMMMMMMMMD...',
    '....DMMMMMMD....',
    '.....DMMMMD.....',
    '......DDDD......',
    '................',
    '................',
    '................',
    '................',
  ],
  gem: [
    '................',
    '................',
    '.....DDDD.......',
    '....DMMMMD......',
    '...DMHHHMMD.....',
    '...DMMMMMMD.....',
    '...DMMMMMMDD....',
    '....DMMMMMMD....',
    '.....DDDDDD.....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  dust: [
    '................',
    '................',
    '.......HH.......',
    '.....HHMMH......',
    '....HMMMMMD.....',
    '...HMMMMMMMD....',
    '..HMMMMMMMMMD...',
    '..DMMMMMMMMD....',
    '...DDDDDDDD.....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  apple: [
    '................',
    '........W.......',
    '.......W.GG.....',
    '.....HHHHHHH....',
    '....HMMMMMMMD...',
    '...HMHHMMMMMMD..',
    '...HMHMMMMMMMD..',
    '...HMMMMMMMMMD..',
    '...DMMMMMMMMD...',
    '....DMMMMMMD....',
    '.....DD..DD.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  meat: [
    '................',
    '................',
    '.....DDDDDD.....',
    '...DDMMMMMMHD...',
    '..DMMMMWWMMMMD..',
    '..DMMMWWWMMMMD..',
    '..DMMMMWWMMMMD..',
    '...DDMMMMMMDD...',
    '.....DDDDDD.....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  bread: [
    '................',
    '................',
    '.....HHHHHH.....',
    '...HHMMMMMMHH...',
    '..HMMHHMMHHMMD..',
    '..HMMMMMMMMMMD..',
    '..DMMMMMMMMMMD..',
    '...DDDDDDDDDD...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
};

/**
 * Render and cache a crisp pixel-art data URL icon (isometric 3D block or 2D pixel sprite)
 * for any block or item ID in src/core/items.js. Returns '' in headless Node environments.
 */
export function renderItemIconDataUrl(itemId, size = 48) {
  if (typeof document === 'undefined' || itemId == null || itemId === BLOCK.AIR) return '';
  const key = `${itemId}:${size}`;
  const existing = iconCache.get(key);
  if (existing) return existing;

  const item = getItemDef(itemId);
  if (!item) return '';

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  if (item.category === 'block') {
    const atlas = getSharedAtlasCanvas();
    const def = getBlockDef(item.blockId);
    if (def.renderType === 'cross' || def.renderType === 'torch') {
      const col = def.tiles.north % ATLAS_COLS;
      const row = Math.floor(def.tiles.north / ATLAS_COLS);
      const pad = Math.round(size * 0.1);
      ctx.drawImage(atlas, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, pad, pad, size - pad * 2, size - pad * 2);
    } else {
      drawIsometricBlockIcon(ctx, atlas, def, size);
    }
  } else {
    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.width = TILE_PX;
    spriteCanvas.height = TILE_PX;
    const sctx = spriteCanvas.getContext('2d');
    const grid = item.category === 'tool'
      ? TOOL_SPRITES[item.toolKind]
      : MATERIAL_SPRITES[item.iconType] ?? MATERIAL_SPRITES.gem;
    const palette = buildToolPalette(item.iconColor ?? '#d8dde2');
    palette.G = '#4fa63a';
    if (item.iconType === 'meat') {
      palette.W = '#f2e8dc';
    }
    drawPixelGrid(sctx, grid, palette);
    const pad = Math.round(size * 0.08);
    ctx.drawImage(spriteCanvas, 0, 0, TILE_PX, TILE_PX, pad, pad, size - pad * 2, size - pad * 2);
  }

  const url = canvas.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}
