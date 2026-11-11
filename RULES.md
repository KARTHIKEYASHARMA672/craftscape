# 📜 CraftScape — Engineering Rules & Quality Standards

> 📌 **Purpose:** Project-specific engineering guardrails derived from global instructions and enforced skills.

---

## 1. Instruction Precedence
1. Global platform & safety rules (`C:\Users\karth\.gemini\GEMINI.md`).
2. User request (`l:\pr 26(minecraft)` — clean Minecraft game built via subagents and full verification).
3. `ARCHITECTURE.md`, `DESIGN.md`, and `RULES.md`.

## 2. Module & Code Discipline
- Pure ES2024 JavaScript (`type: "module"`), **zero** `.ts`/`.tsx`/`.jsx` files so runtime/tests/Vite stay fast and uniform.
- **Disjoint Module Boundaries:** Never import UI DOM code into `src/core/`, `src/world/`, `src/render/mesher.js`, `src/gameplay/raycast.js`, `src/gameplay/physics.js`, or `src/systems/recipes.js` — pure simulation layers MUST run cleanly in headless Node/Vitest!
- **No Global Polluting:** Dispose Three.js geometries/textures cleanly when unloading chunks to avoid GPU memory leaks (`geometry.dispose()`).
- **UV Safety:** Always inset tile UVs by `UV_INSET` (`0.0012`) to prevent mipmap/nearest-edge texture bleeding.

## 3. Definition of Done
- `npm run lint` passes with `0` errors and `0` warnings.
- `npm test` (Vitest) passes 100% across all suites.
- `npm run build` succeeds cleanly.
- Live headless Chromium WebGL2 verification confirms zero console errors, zero page errors, crisp UI layout, working controls, and verified screenshots.
