# 🧠 CraftScape — Project Memory

> 📌 **Status:** Hosted on Netlify ([`craftscape-voxel.netlify.app`](https://craftscape-voxel.netlify.app)) & verified `2026-11-11` on `l:\pr 26(minecraft)`.

---

## Confirmed Decisions
- **Stack:** Pure ES2024 JS (`27` source files in `src/`, `0` `.ts`/`.tsx`/`.jsx`) + Three.js `0.175.0` + Vite `6.x` + Vitest `3.x` + ESLint `9.x`.
- **World Scale:** `16 × 128 × 16` chunks, `SEA_LEVEL = 42`, `DEFAULT_RENDER_DISTANCE = 5`, deterministic seeded multi-biome terrain (Plains, Forest, Desert, Snowy Peaks, Lush Valley).
- **Visual Style:** *Tactile Mineral & Timber Craft* (`#0F1318` obsidian-slate panels, `#FBF5E6` cream ink, `#2E8B57` emerald, `#D9A441` gold), 256×256 procedural pixel atlas + per-vertex Smooth Ambient Occlusion + skylight/torchlight vertex colors + custom GLSL chunk shaders.
- **UI & Polish Fixes Applied:**
  - Added inline SVG voxel favicon to `index.html` eliminating `/favicon.ico` 404 requests.
  - Enabled Recipe Book (`37` recipes) + dynamic modal header (`POCKET CRAFTING & BACKPACK`) when switching to the `Crafting` tab inside Creative Mode (`src/ui/menus.js`).
  - Assigned crisp `Plus Jakarta Sans` uppercase labels to dense buttons/pills/headings while retaining `Silkscreen` for display titles (`src/ui/styles.css`).
  - Added back-of-head hair & explorer backpack/clasp details on the F5 third-person avatar rig (`src/engine/ViewModel.js`) and warmed shadow bounce on entity hemisphere lighting (`src/render/sky.js`).

## Verification Record
- **Static Checks:** `npm run lint` (`0` errors, `0` warnings) · `npm test` (`5` files, `60/60` passed) · `npm run build` (`31` modules, `1.87s`).
- **Live Browser WebGL2:** Playwright Chromium (`1280×720` against `http://127.0.0.1:4173/`) passed with `ok: true`, `0` console/HTTP/page errors, `57` preloaded chunks, `47/47` item visuals rendered, IndexedDB save/load verified, and all `7` screenshots inspected.
- **Note / Limitation:** Web Audio synthesis (`SoundEngine`) cannot be aurally heard inside headless CI without speakers, though its Gain/Oscillator node paths are invoked safely without throwing errors.
