# 🧱 CraftScape — Product Requirements Document (PRD)

> 📌 **Summary:** **CraftScape** is a clean, 60 FPS Minecraft-inspired 3D voxel sandbox built with Pure ES2024 JavaScript, Three.js, procedural 16×16 pixel textures, smooth per-vertex ambient occlusion, voxel skylight/torchlight propagation, Survival & Creative game modes, crafting, smelting, chests, TNT, mobs, procedural Web Audio, and IndexedDB persistence.

---

## 📋 Document Properties

| Property | Value |
| :--- | :--- |
| **Product Name** | CraftScape (`craftscape`) |
| **Status** | Verified Release (`2026-11-11`) |
| **Target Platform** | Modern Desktop WebGL2 Browsers (Chrome, Edge, Firefox) |
| **Primary Stack** | Pure ES2024 JS + Three.js `0.175.0` + Vite `6.x` + Vitest + ESLint |
| **Game Modes** | Survival Mode · Creative Mode (live switchable) |
| **Persistence** | Browser IndexedDB (multi-world slots + JSON export/import) |

---

## 🧭 Table of Contents

- [1. Vision & Principles](#1-vision--principles)
- [2. Functional Requirements](#2-functional-requirements)
- [3. Non-Functional Requirements](#3-non-functional-requirements)
- [4. Explicit Non-Goals](#4-explicit-non-goals)
- [5. Acceptance Criteria & Traceability](#5-acceptance-criteria--traceability)

---

## 1. Vision & Principles

- **Clean First, Always:** Uncluttered gameplay screen showing only crosshair, crisp 9-slot hotbar, vital bars (Survival), and optional `[F3]` telemetry.
- **Authentic Voxel Feel:** Real 3D DDA block targeting, per-vertex Smooth Ambient Occlusion, directional sunlight + cave torchlight, sneaking edge-guard, double-tap Space Creative flight, swimming buoyancy, and tool-tier mining speed.
- **Zero External Asset Fragility:** 100% procedural 256×256 crisp pixel texture atlas and Web Audio sound synthesis — zero broken image/audio URLs.

---

## 2. Functional Requirements

| ID | Priority | Requirement | Target Module(s) |
| :--- | :--- | :--- | :--- |
| **FR-001** | Must | Deterministic seeded terrain generation across 5 biomes (Plains, Forest, Desert, Snowy Peaks, Lush Valley) with 3D caves, ores, lakes, trees, cacti, and wildflowers. | `src/world/` |
| **FR-002** | Must | Chunk streaming (`16×128×16`) with neighbor-aware face culling, smooth per-vertex AO, and skylight/blocklight vertex coloring (`0..15`). | `src/render/mesher.js`, `src/world/lighting.js` |
| **FR-003** | Must | Precise 3D DDA voxel raycasting (`5.5` block reach), wireframe highlight, progressive survival mining cracks, instant creative break, and middle-click/Q pick-block. | `src/gameplay/raycast.js`, `src/engine/` |
| **FR-004** | Must | Swept AABB player physics with walk, sprint, crouch/sneak edge-guard, jump, water swimming/oxygen, fall damage, and Creative flight (`Space` double-tap). | `src/gameplay/physics.js` |
| **FR-005** | Must | 36-slot Inventory + 9-slot Hotbar (`1–9` / scroll), 2×2 pocket crafting, 3×3 Crafting Table (`Right-Click`), Furnace smelting (`Right-Click`), Persistent Chests, and TNT ignition. | `src/systems/`, `src/ui/` |
| **FR-006** | Must | Living world mobs (Sheep, Cow, Pig, Zombie, Creeper) with articulated limb animation, wander/chase/explosion AI, daylight zombie burning, and item drops. | `src/gameplay/mobs.js`, `src/gameplay/entities.js` |
| **FR-007** | Must | Dynamic Day/Sunset/Night sky dome, sun, moon, drifting voxel clouds, starfield, and horizon-matched fog. | `src/render/sky.js` |
| **FR-008** | Must | Procedural Web Audio synthesizer (biome/surface footsteps, block break/place, pickup chime, explosion boom, hurt, UI click) with volume control. | `src/gameplay/audio.js` |
| **FR-009** | Must | Title screen over live 3D world panorama, Pause/Settings menu (`Esc`), slash commands (`T` / `/`), and multi-world IndexedDB save/load + JSON backup. | `src/ui/`, `src/systems/storage.js`, `src/systems/commands.js` |

---

## 3. Non-Functional Requirements

- **Performance:** Target smooth `60 FPS` at default render distance (`5` chunks radius) using single-atlas chunk draw calls and throttled chunk meshing budget.
- **Visual Craft:** Nearest-neighbor crisp pixels with half-texel UV inset (`UV_INSET = 0.0012`) to prevent seam bleeding; zero WebGL context errors or console errors.
- **Accessibility & Legibility:** High-contrast warm cream ink (`#FBF5E6`) on dark obsidian-slate frosted panels (`>= 7:1` contrast), full keyboard controls reference, and clear visual feedback.

---

## 4. Explicit Non-Goals

- Multiplayer WebSocket networking or external server backend (local single-player sandbox only).
- External copyrighted Mojang texture/sound binaries (all assets are 100% procedurally generated).

---

## 5. Acceptance Criteria & Traceability

- [x] `npm run lint` passes with `0` errors and `0` warnings.
- [x] `npm test` (Vitest) passes 100% across `world`, `mesher`, `gameplay`, `systems`, and `integration` suites (`5` files, `60/60` passed).
- [x] `npm run build` produces clean `dist/` bundle.
- [x] Live headless Chromium WebGL2 visual verification captures Title, Gameplay, Crafting/Inventory, Night/Torch, and Pause screens with `0` console/page/network errors.
