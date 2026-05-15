import "./styles.css";
import * as THREE from "three";
import { createViewport, type ViewName } from "./scene/viewport";
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

// --- Toolbar ---------------------------------------------------------------
const toolbar = document.getElementById("toolbar")!;
const toolbar2 = document.getElementById("toolbar2")!;
const modeButtons = toolbar.querySelectorAll<HTMLButtonElement>(".mode-btn");
const viewButtons = toolbar.querySelectorAll<HTMLButtonElement>(".view-btn");
const fovButtons = toolbar2.querySelectorAll<HTMLButtonElement>(".fov-btn");
const snapToggle = document.getElementById("snap-toggle") as HTMLInputElement;
const undoBtn = toolbar.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
const redoBtn = toolbar.querySelector<HTMLButtonElement>('[data-action="redo"]')!;

toolbar2.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-fov]");
  if (!btn) return;
  const fov = parseFloat(btn.dataset.fov!);
  fovButtons.forEach((b) => b.classList.toggle("active", b === btn));
  await viewport.setFov(fov);
});

function setMode(mode: "translate" | "rotate" | "scale") {
  transform.setMode(mode);
  modeButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.action === mode);
  });
  rail.setMode(mode);
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

// --- Right rail (Mighty UI) -----------------------------------------------
// Floating right-side control panel: camera widget + FRAME, transform mode,
// snap, edit ops, history. Lives alongside the legacy top toolbar — both
// drive the same actions. The legacy `setMode`, the snap toggle, and the
// history.onChange handlers below are extended to also call rail.set*()
// so the rail's visual state stays in sync.
const rail = createRightRail({
  container: document.getElementById("viewport-wrap")!,
  viewport,
  getSelectionBbox: selectionBbox,
  onFrame: frameTarget,
  onSetMode: (mode) => setMode(mode),
  onToggleSnap: (snap) => {
    snapToggle.checked = snap;
    transform.setSnap(snap);
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

// Initial sync — both UIs start in the same state.
rail.setMode("translate");
rail.setSnap(snapToggle.checked);

toolbar.addEventListener("click", async (e) => {
  const viewBtn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]");
  if (viewBtn) {
    const v = viewBtn.dataset.view as ViewName;
    if (v === viewport.view) return;
    viewButtons.forEach((b) => b.classList.toggle("active", b === viewBtn));
    await viewport.setView(v, selectionBbox());
    return;
  }
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  switch (action) {
    case "undo":
      history.undo();
      break;
    case "redo":
      history.redo();
      break;
    case "translate":
    case "rotate":
    case "scale":
      setMode(action);
      break;
    case "duplicate":
      if (selection.list.length)
        history.execute(duplicateCommand(viewport.root, selection.list, selection));
      break;
    case "delete":
      if (selection.list.length)
        history.execute(deleteCommand(viewport.root, selection.list, selection));
      break;
    case "group":
      if (selection.list.length >= 2)
        history.execute(groupCommand(viewport.root, selection.list, selection));
      break;
    case "frame":
      await frameTarget();
      break;
    case "export":
      try {
        await exportScene(viewport.root, { binary: true });
      } catch (err) {
        console.error("Export failed:", err);
        alert(`Export failed: ${(err as Error).message}`);
      }
      break;
  }
});

snapToggle.addEventListener("change", () => {
  transform.setSnap(snapToggle.checked);
  rail.setSnap(snapToggle.checked);
});

history.onChange((canUndo, canRedo) => {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
  rail.setHistoryState(canUndo, canRedo);
});
undoBtn.disabled = true;
redoBtn.disabled = true;

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
      snapToggle.checked = transform.toggleSnap();
      rail.setSnap(snapToggle.checked);
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
