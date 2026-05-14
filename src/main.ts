import "./styles.css";
import { createViewport } from "./scene/viewport";
import { listElements, instantiate, type ElementDefinition } from "./library";
import { renderSidebar } from "./ui/sidebar";
import { Selection } from "./editing/selection";
import { TransformManager, snapshot } from "./editing/transform";
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
const selection = new Selection();
const history = new History();

const transform = new TransformManager({
  camera: viewport.camera,
  domElement: canvas,
  scene: viewport.scene,
  orbit: viewport.controls,
  onCommit: (obj, before) => {
    history.push(transformCommand(obj, before, snapshot(obj)));
  },
});

// Selection drives TransformControls attachment.
selection.onChange((sel) => {
  // Attach to the primary (last selected) object.
  transform.attach(sel.length > 0 ? sel[sel.length - 1] : null);
});

// --- Sidebar ---------------------------------------------------------------
const sidebarEl = document.getElementById("library-list")!;
renderSidebar({
  container: sidebarEl,
  elements: listElements(),
  onPick: (def: ElementDefinition) => {
    const obj = instantiate(def.id);
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
const modeButtons = toolbar.querySelectorAll<HTMLButtonElement>(".mode-btn");
const snapToggle = document.getElementById("snap-toggle") as HTMLInputElement;
const undoBtn = toolbar.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
const redoBtn = toolbar.querySelector<HTMLButtonElement>('[data-action="redo"]')!;

function setMode(mode: "translate" | "rotate" | "scale") {
  transform.setMode(mode);
  modeButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.action === mode);
  });
}

toolbar.addEventListener("click", async (e) => {
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

snapToggle.addEventListener("change", () => transform.setSnap(snapToggle.checked));

history.onChange((canUndo, canRedo) => {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
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
