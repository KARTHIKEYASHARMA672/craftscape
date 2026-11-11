const DB_NAME = 'craftscape-worlds-v1';
const DB_VERSION = 1;
const STORE_NAME = 'worlds';

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < B64_ALPHABET.length; i += 1) {
  B64_LOOKUP[B64_ALPHABET.charCodeAt(i)] = i;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function uint8ToBase64(bytes) {
  if (!bytes || bytes.length === 0) return '';
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;

    out += B64_ALPHABET[(triplet >> 18) & 0x3f];
    out += B64_ALPHABET[(triplet >> 12) & 0x3f];
    out += i + 1 < len ? B64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
    out += i + 2 < len ? B64_ALPHABET[triplet & 0x3f] : '=';
  }
  return out;
}

function base64ToUint8(b64) {
  if (!b64 || typeof b64 !== 'string') return new Uint8Array(0);
  const clean = b64.replace(/=+$/, '');
  const byteLen = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(byteLen);

  let outIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_LOOKUP[clean.charCodeAt(i)];
    const c1 = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c2 = i + 2 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const c3 = i + 3 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 3)] : 0;
    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

    if (outIdx < byteLen) bytes[outIdx++] = (triplet >> 16) & 0xff;
    if (outIdx < byteLen) bytes[outIdx++] = (triplet >> 8) & 0xff;
    if (outIdx < byteLen) bytes[outIdx++] = triplet & 0xff;
  }
  return bytes;
}

function encodeValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return undefined;

  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array) {
    return { __csType: 'Uint8Array', data: uint8ToBase64(value) };
  }
  if (value instanceof Map) {
    if (seen.has(value)) throw new Error('Circular reference in world save Map');
    seen.add(value);
    const entries = [];
    for (const [k, v] of value.entries()) {
      entries.push([encodeValue(k, seen), encodeValue(v, seen)]);
    }
    seen.delete(value);
    return { __csType: 'Map', entries };
  }
  if (value instanceof Set) {
    if (seen.has(value)) throw new Error('Circular reference in world save Set');
    seen.add(value);
    const values = [];
    for (const v of value.values()) {
      values.push(encodeValue(v, seen));
    }
    seen.delete(value);
    return { __csType: 'Set', values };
  }
  if (typeof value.serialize === 'function') {
    return encodeValue(value.serialize(), seen);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Circular reference in world save Array');
    seen.add(value);
    const arr = value.map((item) => encodeValue(item, seen));
    seen.delete(value);
    return arr;
  }

  if (seen.has(value)) throw new Error('Circular reference in world save Object');
  seen.add(value);
  const obj = {};
  for (const [key, val] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const encoded = encodeValue(val, seen);
    if (encoded !== undefined) {
      obj[key] = encoded;
    }
  }
  seen.delete(value);
  return obj;
}

function decodeValue(node) {
  if (node === null || node === undefined || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => decodeValue(item));
  }
  if (node.__csType === 'Uint8Array' && typeof node.data === 'string') {
    return base64ToUint8(node.data);
  }
  if (node.__csType === 'Map' && Array.isArray(node.entries)) {
    const map = new Map();
    for (const [k, v] of node.entries) {
      map.set(decodeValue(k), decodeValue(v));
    }
    return map;
  }
  if (node.__csType === 'Set' && Array.isArray(node.values)) {
    const set = new Set();
    for (const v of node.values) {
      set.add(decodeValue(v));
    }
    return set;
  }

  const result = {};
  for (const [key, val] of Object.entries(node)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    result[key] = decodeValue(val);
  }
  return result;
}

export function serializeWorldSave(state) {
  return JSON.stringify(encodeValue(state ?? {}));
}

export function parseWorldSave(raw) {
  if (raw == null) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return decodeValue(parsed);
}

function makeSummary(record) {
  return {
    id: record.id,
    name: record.name,
    seed: record.seed,
    gameMode: record.gameMode,
    difficulty: record.difficulty,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function generateWorldId(name) {
  const slug = String(name || 'world')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20) || 'world';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug}-${suffix}`;
}

export class WorldStorage {
  constructor(options = {}) {
    this._idb = options.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : null);
    this._memory = new Map();
    this._dbPromise = null;
  }

  isUsingMemoryFallback() {
    return !this._idb;
  }

  async _openDb() {
    if (!this._idb) return null;
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve) => {
      try {
        const request = this._idb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          this._idb = null;
          resolve(null);
        };
      } catch {
        this._idb = null;
        resolve(null);
      }
    });

    return this._dbPromise;
  }

  async listWorlds() {
    const db = await this._openDb();
    if (!db) {
      return [...this._memory.values()]
        .map(makeSummary)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = (req.result ?? [])
          .map(makeSummary)
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        resolve(records);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveWorld(worldRecord) {
    if (!worldRecord || typeof worldRecord !== 'object') {
      throw new Error('World record must be an object');
    }

    const now = Date.now();
    const id = String(worldRecord.id || generateWorldId(worldRecord.name));
    const normalized = {
      ...worldRecord,
      id,
      name: String(worldRecord.name || 'Untitled World').trim().slice(0, 64) || 'Untitled World',
      seed: worldRecord.seed ?? 0,
      gameMode: worldRecord.gameMode ?? 'survival',
      difficulty: worldRecord.difficulty ?? 'normal',
      createdAt: worldRecord.createdAt ?? now,
      updatedAt: worldRecord.updatedAt ?? now,
    };

    const dbEntry = {
      ...makeSummary(normalized),
      payload: serializeWorldSave(normalized),
    };

    const db = await this._openDb();
    if (!db) {
      this._memory.set(id, dbEntry);
      return makeSummary(dbEntry);
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(dbEntry);
      req.onsuccess = () => resolve(makeSummary(dbEntry));
      req.onerror = () => reject(req.error);
    });
  }

  async loadWorld(worldId) {
    if (!worldId) return null;
    const id = String(worldId);
    const db = await this._openDb();

    let entry = null;
    if (!db) {
      entry = this._memory.get(id) ?? null;
    } else {
      entry = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    }

    if (!entry) return null;
    return parseWorldSave(entry.payload);
  }

  async deleteWorld(worldId) {
    if (!worldId) return false;
    const id = String(worldId);
    const db = await this._openDb();

    if (!db) {
      return this._memory.delete(id);
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (!getReq.result) {
          resolve(false);
          return;
        }
        const delReq = store.delete(id);
        delReq.onsuccess = () => resolve(true);
        delReq.onerror = () => reject(delReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }
}
