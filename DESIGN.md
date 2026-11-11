# 🎨 CraftScape — Visual Design & Interaction Spec

> 📌 **Aesthetic Declaration (Tactile Mineral & Timber Craft):** Crisp dark obsidian-slate glass panels (`rgba(15, 19, 24, 0.80)`), warm parchment cream ink (`#FBF5E6`), pixel-chamfered `2px` mineral borders, and restrained Mineral Emerald (`#2E8B57`) + Brass Gold (`#D9A441`) accents. Zero clutter during active gameplay.

---

## 📋 Design Tokens

| Token | Value | Role |
| :--- | :--- | :--- |
| `--bg-panel` | `rgba(15, 19, 24, 0.84)` | HUD, modal, and pause backdrop |
| `--bg-slot` | `rgba(34, 41, 51, 0.85)` | Inventory / hotbar cell background |
| `--border-slot` | `#4A5564` | Subtle crisp slot frame |
| `--accent-gold` | `#D9A441` | Selected hotbar slot & primary CTA highlight |
| `--accent-emerald` | `#2E8B57` | Primary play / confirm button |
| `--ink-primary` | `#FBF5E6` | Primary readable text |
| `--ink-muted` | `#A7B0BC` | Secondary labels & keycap hints |
| `--danger` | `#D9463E` | Health / explosion / destructive actions |

---

## 🔤 Typography

- **Display / HUD Badges:** `'Silkscreen', 'Courier New', monospace`
- **Body / Tooltips:** `'Plus Jakarta Sans', system-ui, -apple-system, sans-serif`
- **F3 Debug & Commands:** `'JetBrains Mono', ui-monospace, monospace`

---

## 🎮 HUD & Screen Hierarchy

1. **Title Screen (Initial Load):**
   - Full-bleed live rotating 3D panoramic camera sweeping across the generated voxel terrain right behind a refined glass card.
   - Primary action: **Play World** + **World Name / Seed Selector** + **Game Mode (`Survival` / `Creative`)** + **Quick Controls**.
2. **In-Game HUD (Pointer Locked):**
   - Center `14px` crisp crosshair (`mix-blend-mode: difference` + subtle dark halo for 100% sky/snow contrast).
   - Bottom-center `9`-slot Hotbar (`48px` tiles with rendered 3D/isometric atlas previews, stack counts, durability bars, and brief item tooltip fade).
   - Above hotbar (Survival only): Crisp SVG Hearts (`10` = `20 HP`), Drumsticks (`10` = `20 Hunger`), and Underwater Oxygen Bubbles (`10`, shown only when submerged).
   - Optional `[F3]` compact top-left telemetry panel (FPS, XYZ, Chunk, Biome, Light, Facing, Seed).
   - Ephemeral `[T]` / `[/]` chat/command bar at bottom-left.
3. **Interactive Modals (`E` Inventory / Crafting Table / Furnace / Chest):**
   - Centered tactile craft modal showing 36-slot grid + context panel (2×2 Pocket Craft, 3×3 Table, Furnace with flame & arrow progress, or 27-slot Chest + Creative Catalog tab when in Creative Mode!).
4. **Pause Screen (`Esc`):**
   - Clean vertical card: **Resume Game**, **Game Mode**, **Difficulty**, **Render Distance (`3–9`)**, **FOV (`60–100`)**, **Mouse Sensitivity**, **Audio Volume**, **Save & Exit to Title**.
