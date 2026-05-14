# Webstructor

Browser-based **kitbashing tool** built on three.js. Compose scenes from a
data-driven library of elements (primitives + GLB assets) and export the
result as a single `.glb` file.

Stack: **Vite + Vanilla TypeScript + three.js** — no React, no R3F.

> **Status:** early-stage scaffolding. Primitives and GLB assets are
> placeholders; the long-term creative payload is a family of **procedural
> widgets** (parameterized, generated geometry) built on the same registry.

---

## Quick start

```bash
npm install
npm run dev        # vite dev server on http://localhost:5173
npm run build      # tsc --noEmit && vite build (output → dist/)
npm run typecheck  # tsc --noEmit
```

No environment variables required.

---

## Controls

| Input | Action |
| ----- | ------ |
| Left-click an item in the sidebar | Add element to the scene |
| Left-click an object | Select |
| Shift + click | Toggle selection (multi-select) |
| Click empty space | Clear selection |
| **W / E / R** | Translate / Rotate / Scale gizmo mode |
| **X** | Toggle snapping (0.25 / 15° / 0.1) |
| Hold Shift while dragging gizmo | Temporary snap |
| **F** | Frame the current selection (or all content if nothing selected) |
| **Ctrl + D** | Duplicate selection |
| **Ctrl + G** | Group ≥2 selected objects |
| **Delete** | Delete selection |
| **Ctrl + Z / Ctrl + Shift + Z** | Undo / Redo |
| Toolbar view buttons (3D, F, B, L, R, T, Bot) | Switch named camera view (animated) |
| Toolbar FOV row (10°…100°) | Animate the perspective FOV |
| **Export GLB** | Download the scene as a `.glb` file |

---

## Architecture

```
src/
├── main.ts                 — wiring: viewport ↔ sidebar ↔ selection ↔ transform ↔ history
├── library/
│   ├── registry.ts         — ElementDefinition + registry + instantiate()
│   ├── primitives.ts       — box/sphere/cylinder/cone/torus/plane/capsule/tetra
│   ├── models.ts           — GLB-backed assets (cached + per-instance deep clone)
│   └── index.ts            — side-effect imports register entries
├── scene/
│   └── viewport.ts         — renderer, camera, IBL, named views, animations, frame()
├── editing/
│   ├── selection.ts        — selection set with BoxHelper outlines
│   ├── transform.ts        — TransformControls + centroid-pivot multi-select
│   ├── picking.ts          — raycast → top-level scene object
│   ├── history.ts          — undo/redo stack
│   └── commands.ts         — Add / Delete / Duplicate / Group / Transform
├── export/
│   └── gltf.ts             — GLTFExporter wrapper (binary GLB)
├── ui/
│   └── sidebar.ts          — library list renderer
└── styles.css

data/                       — GLB source assets (loaded via Vite ?url imports)
output/                     — generated docs / worklogs (gitignored except docs)
```

**Key design choice — the element registry.** Every library entry is an
`ElementDefinition { id, label, category, create }`. The `create()` factory
returns an arbitrary `Object3D` (sync or `Promise`). Primitives, GLBs, and
future procedural widgets all plug into this one interface. When procedural
widgets need parameters, extend `ElementDefinition` with a parameter schema —
don't build a parallel system.

**Helpers vs. content.** Everything user-created lives under `viewport.root`;
that's what `GLTFExporter` serialises. Grid, axes, and selection outlines
live under `viewport.helpers` and are never exported.

**Selection outlines** use `THREE.BoxHelper` (refreshed per-frame via
`viewport.onTick`) instead of material tinting — works uniformly for
PBR-materialed GLB content.

**Multi-select transforms** route through an invisible `__multiPivot` placed
at the selection centroid. On drag the world-space delta is decomposed back
to each object's local TRS through its parent's inverse, so children of
groups behave correctly.

---

## Features

### Shipped

- ✅ Library registry with async-capable factories
- ✅ Primitive library (8 shapes)
- ✅ GLB asset library with per-URL load cache + per-instance deep clone
- ✅ Selection (single + multi via Shift-click)
- ✅ Selection outlines via `BoxHelper`
- ✅ Transform gizmo (translate / rotate / scale) with snapping
- ✅ Multi-select transforms via centroid pivot
- ✅ Undo / redo for add, delete, duplicate, group, transform
- ✅ Duplicate with per-instance geometry + material clone
- ✅ Group operation
- ✅ Image-based lighting (PMREM-prefiltered `RoomEnvironment`)
- ✅ Named camera views: perspective + 6 axis views with locked-rotate
- ✅ Animated view transitions (slerp, great-circle waypoints, cubic ease)
- ✅ Two-phase "rotate then frame" animation for 3D↔axis
- ✅ Animated FOV presets (10° / 25° / 40° / 50° / 75° / 100°)
- ✅ Frame-selection (F key + toolbar button)
- ✅ GLB export of the entire `root` group
- ✅ Light theme

### Backlog / Tickets

Logical next work items inferred from the current code shape and the
project's stated goal (procedural widgets). These are not yet GitHub issues;
file them upstream as they get picked up.

#### P0 — unblocks the procedural-widget direction

- **[WS-1] Parameter schema on `ElementDefinition`.**
  Add an optional `params: ParamSchema[]` field. Each param has `id`, `label`,
  `type` (`number | int | bool | color | enum`), range/step/default. Factory
  signature changes to `create(values: ParamValues): Object3D | Promise<Object3D>`.
  Instances store the values they were created with in
  `userData.elementParams` for round-trip and re-evaluation.
  *Why:* the registry today only supports zero-arg factories, which is the
  hard blocker for procedural widgets.

- **[WS-2] Inspector / parameter panel.**
  Right-hand panel that, for the active selection, shows: name, TRS values,
  and (if the instance has an `elementId` with a `params` schema) sliders /
  inputs that re-run the factory and swap geometry on change.
  *Why:* edits to procedural widgets need to be live; raw TRS values also
  belong here so users stop relying solely on the gizmo for fine adjustments.

- **[WS-3] First procedural widget.**
  Ship one real widget (e.g. parametric panel/grating, hull frame, or bolted
  plate) using the new schema. Validates the pipeline end-to-end.

#### P1 — editor essentials

- **[WS-4] Outliner panel.**
  Tree view of `viewport.root`. Click → select. Drag → reparent.
  Visibility/lock toggles per row. Renaming inline.

- **[WS-5] Scene save / load (JSON).**
  Serialise `root` as `{ elementId, params, transform, children }` tuples.
  Loading rebuilds via `instantiate()` — much smaller than GLB and editable
  in source control. Use GLB export for delivery only.

- **[WS-6] Drag-and-drop GLB import.**
  Drop a `.glb` onto the canvas to (a) instantiate it once *and* (b) register
  a temporary `asset.<hash>` entry in the library so it can be reused in the
  same session.

- **[WS-7] Per-element material override.**
  Inspector control to swap color / metalness / roughness on the selection
  without touching the source material. Required before procedural widgets
  become useful kits.

- **[WS-8] Pivot / origin controls.**
  Move the gizmo to bbox-bottom / bbox-center / world-origin. Crucial when
  combining parts from different sources.

#### P2 — polish

- **[WS-9] Orthographic mode for axis views.**
  The six axis views currently use the perspective camera with rotation
  locked. Add an actual ortho camera toggle so technical-drawing-style
  layouts are dimensionally honest.

- **[WS-10] Grid + ground-plane snapping.**
  Snap object base to grid Y=0 on translate. Optional axis-constrained
  snapping along grid lines.

- **[WS-11] Selection box-select (marquee).**
  Drag on empty canvas to select all objects inside the rectangle.

- **[WS-12] Larger / curated asset library.**
  Categorised browser (sci-fi / nature / vehicles / props), search, thumbnails
  generated on first load via offscreen renderer.

- **[WS-13] Keyboard shortcut overlay.**
  `?` key opens a modal listing all bindings. Synced with the source of
  truth in `main.ts`.

- **[WS-14] Touch / pen support.**
  Gizmo and orbit controls work but haven't been verified on touch devices.

#### P3 — speculative

- **[WS-15] Procedural widget library.**
  The main creative payload — a dozen+ parameterised widgets covering greebles,
  panels, joinery, hull plating, etc.

- **[WS-16] Boolean operations (CSG).**
  Union / subtract / intersect on selected meshes. Needs a CSG dependency
  (`three-bvh-csg` or similar).

- **[WS-17] LOD / asset budget warnings.**
  Track polycount per object and total scene cost; warn when GLB export
  exceeds a configurable budget.

---

## Conventions

- TypeScript strict mode, including `noUnusedLocals` and
  `noImplicitOverride` — `npm run typecheck` must pass before commit.
- Helpers (anything that should not be exported) live under
  `viewport.helpers`. Anything intended for export lives under
  `viewport.root`.
- Library entries are registered via side-effect imports in
  `src/library/index.ts`. Adding a new file there is enough — no central
  enum to update.
- New documentation / generated artifacts go in `output/`.

---

## License

Not yet specified. Treat as **all rights reserved** until a license file is
added.
