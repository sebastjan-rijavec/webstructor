import "./styles.css";
import * as THREE from "three";
import { createViewport } from "./scene/viewport";
import { listElements, instantiate, type ElementDefinition } from "./library";
import { renderSidebar } from "./ui/sidebar";
import { createRightRail } from "./ui/right-rail";
import { Selection } from "./editing/selection";
import { TransformManager } from "./editing/transform";
import { pickTopLevel, screenToNdc } from "./editing/picking";
import { History } from "./editing/history";
import {
  addCommand,
  deleteCommand,
  duplicateCommand,
  groupCommand,
  transformCommand,
} from "./editing/commands";
import { exportScene } from "./export/gltf";

const canvas = document.getElementById("viewport") as HTMLCanvasElement;
const viewport = createViewport(canvas);
const selection = new Selection(viewport.helpers);
const history = new History();

// --- Version display ------------------------------------------------------
// Top-center label showing the build's package.json version. __APP_VERSION__
// is injected by Vite (see vite.config.ts + src/types/globals.d.ts).
const versionDisplay = document.getElementById("version-display")!;
versionDisplay.textContent = `v${__APP_VERSION__}`;

// --- Theme ----------------------------------------------------------------
type ThemeName = "bright" | "dark";
let currentTheme: ThemeName =
  (localStorage.getItem("webstructor-theme") as ThemeName | null) ?? "bright";

function applyTheme(theme: ThemeName): void {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("webstructor-theme", theme);
  // 3D scene background tracks the chrome via the --scene-bg token so the
  // canvas reads as part of the themed surface rather than fighting it.
  const root = getComputedStyle(document.documentElement);
  const sceneBg = root.getPropertyValue("--scene-bg").trim();
  if (sceneBg) viewport.scene.background = new THREE.Color(sceneBg);
  // Grid is bright on cream but reads as over-bright against the dark
  // scene background — tone it via --grid-opacity per theme.
  const gridOpacity = parseFloat(root.getPropertyValue("--grid-opacity"));
  if (Number.isFinite(gridOpacity)) viewport.setGridOpacity(gridOpacity);
}

function toggleTheme(): void {
  const next: ThemeName = currentTheme === "bright" ? "dark" : "bright";
  applyTheme(next);
  rail.setTheme(next);
}

applyTheme(currentTheme);

viewport.onTick(() => selection.updateHelpers());

const transform = new TransformManager({
  camera: viewport.camera,
  domElement: canvas,
  scene: viewport.scene,
  orbit: viewport.controls,
  onCommit: (records) => {
    history.push(transformCommand(records));
  },
});

// Selection drives TransformControls attachment. With >1 selected, transforms
// are routed through an internal pivot so the whole selection moves together.
selection.onChange((sel) => {
  transform.setObjects(sel);
});

// --- Sidebar ---------------------------------------------------------------
const sidebarEl = document.getElementById("library-list")!;
renderSidebar({
  container: sidebarEl,
  elements: listElements(),
  onPick: async (def: ElementDefinition) => {
    const obj = await instantiate(def.id);
    history.execute(addCommand(viewport.root, obj, selection));
  },
});

// --- Canvas selection ------------------------------------------------------
let pointerDown: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  pointerDown = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", (e) => {
  if (!pointerDown) return;
  const dx = e.clientX - pointerDown.x;
  const dy = e.clientY - pointerDown.y;
  pointerDown = null;
  // Treat as click only if pointer barely moved (otherwise it's an orbit drag).
  if (Math.hypot(dx, dy) > 4) return;
  // If transform gizmo is currently being dragged, skip.
  if ((transform.controls as unknown as { dragging: boolean }).dragging) return;

  const rect = canvas.getBoundingClientRect();
  const ndc = screenToNdc(e, rect);
  const hit = pickTopLevel(viewport.camera, viewport.root, ndc);
  if (hit) {
    if (e.shiftKey) selection.toggle(hit);
    else selection.set([hit]);
  } else {
    if (!e.shiftKey) selection.clear();
  }
});

// --- Editor actions -------------------------------------------------------
// The right rail owns the full UI surface; main.ts holds the bare action
// functions and routes the rail's callbacks back into the editor state.

function setMode(mode: "translate" | "rotate" | "scale"): void {
  transform.setMode(mode);
  rail.setMode(mode);
}

async function exportGlb(): Promise<void> {
  try {
    await exportScene(viewport.root, { binary: true });
  } catch (err) {
    console.error("Export failed:", err);
    alert(`Export failed: ${(err as Error).message}`);
  }
}

/** Bbox of the selection — or undefined if nothing selected. */
function selectionBbox(): THREE.Box3 | undefined {
  if (selection.list.length === 0) return undefined;
  const bbox = new THREE.Box3();
  for (const obj of selection.list) bbox.expandByObject(obj);
  return bbox;
}

async function frameTarget() {
  const bbox = selectionBbox() ?? new THREE.Box3().setFromObject(viewport.root);
  await viewport.frame(bbox);
}

// --- Grid visibility ------------------------------------------------------
let gridVisible: boolean =
  localStorage.getItem("webstructor-grid-visible") !== "false";
viewport.setGridVisible(gridVisible);

function toggleGrid(): void {
  gridVisible = !gridVisible;
  viewport.setGridVisible(gridVisible);
  localStorage.setItem("webstructor-grid-visible", String(gridVisible));
  rail.setGridVisible(gridVisible);
}

// --- Right rail (Mighty UI) -----------------------------------------------
// Sole UI surface. Drives transform mode, snap, edit ops, history, FOV,
// theme, and grid toggle. Export GLB lives separately as a bottom-center
// floating button (see #export-button) — issue #22 wanted it more prominent
// than a rail entry.
const rail = createRightRail({
  container: document.getElementById("viewport-wrap")!,
  viewport,
  getSelectionBbox: selectionBbox,
  initialTheme: currentTheme,
  initialFov: viewport.camera.fov,
  initialGridVisible: gridVisible,
  onFrame: frameTarget,
  onSetMode: (mode) => setMode(mode),
  onToggleSnap: (snap) => transform.setSnap(snap),
  onToggleTheme: toggleTheme,
  onToggleGrid: toggleGrid,
  onSetFov: (fov) => {
    void viewport.setFov(fov);
  },
  onUndo: () => history.undo(),
  onRedo: () => history.redo(),
  onDuplicate: () => {
    if (selection.list.length)
      history.execute(duplicateCommand(viewport.root, selection.list, selection));
  },
  onGroup: () => {
    if (selection.list.length >= 2)
      history.execute(groupCommand(viewport.root, selection.list, selection));
  },
  onDelete: () => {
    if (selection.list.length)
      history.execute(deleteCommand(viewport.root, selection.list, selection));
  },
});

// Initial mode sync (the rail constructor sets the rest from initial* opts).
rail.setMode("translate");

// Floating Export GLB button — bottom-center of the viewport, primary action.
const exportButton = document.getElementById(
  "export-button",
) as HTMLButtonElement;
exportButton.addEventListener("click", () => {
  void exportGlb();
});

history.onChange((canUndo, canRedo) => {
  rail.setHistoryState(canUndo, canRedo);
});

// --- Keyboard --------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  // Ignore when typing in form fields.
  const t = e.target as HTMLElement;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

  const meta = e.ctrlKey || e.metaKey;

  if (meta && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
    return;
  }
  if (meta && e.key.toLowerCase() === "y") {
    e.preventDefault();
    history.redo();
    return;
  }
  if (meta && e.key.toLowerCase() === "d") {
    e.preventDefault();
    if (selection.list.length)
      history.execute(duplicateCommand(viewport.root, selection.list, selection));
    return;
  }
  if (meta && e.key.toLowerCase() === "g") {
    e.preventDefault();
    if (selection.list.length >= 2)
      history.execute(groupCommand(viewport.root, selection.list, selection));
    return;
  }

  switch (e.key.toLowerCase()) {
    case "w":
      setMode("translate");
      break;
    case "e":
      setMode("rotate");
      break;
    case "r":
      setMode("scale");
      break;
    case "delete":
    case "backspace":
      if (selection.list.length)
        history.execute(deleteCommand(viewport.root, selection.list, selection));
      break;
    case "escape":
      selection.clear();
      break;
    case "x":
      rail.setSnap(transform.toggleSnap());
      break;
    case "f":
      frameTarget();
      break;
  }
});

// Expose a tiny debugging hook (useful when iterating on procedural widgets).
declare global {
  interface Window {
    __webstructor?: {
      viewport: typeof viewport;
      selection: Selection;
      history: History;
    };
  }
}
window.__webstructor = { viewport, selection, history };
