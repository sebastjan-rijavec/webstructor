import type * as THREE from "three";
import type { Viewport } from "../scene/viewport";
import { createCameraOverlay } from "./camera-overlay";

export type ToolMode = "translate" | "rotate" | "scale";

interface RightRailOptions {
  container: HTMLElement;
  viewport: Viewport;
  getSelectionBbox: () => THREE.Box3 | undefined;
  onFrame: () => void;
  onSetMode: (mode: ToolMode) => void;
  onToggleSnap: (snap: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onDelete: () => void;
}

interface RightRailHandle {
  /** Sync the segmented mode buttons to the current transform mode. */
  setMode: (mode: ToolMode) => void;
  /** Sync the snap toggle. */
  setSnap: (snap: boolean) => void;
  /** Enable/disable Undo and Redo according to history availability. */
  setHistoryState: (canUndo: boolean, canRedo: boolean) => void;
  dispose: () => void;
}

/**
 * Right-side control rail: camera widget + FRAME, transform mode, snap,
 * edit operations, history. Lives alongside the legacy top toolbar — both
 * drive the same underlying actions, and `setMode`/`setSnap`/`setHistoryState`
 * keep the rail's visual state in sync when the legacy toolbar changes them.
 */
export function createRightRail(opts: RightRailOptions): RightRailHandle {
  const {
    container,
    viewport,
    getSelectionBbox,
    onFrame,
    onSetMode,
    onToggleSnap,
    onUndo,
    onRedo,
    onDuplicate,
    onGroup,
    onDelete,
  } = opts;

  const el = document.createElement("div");
  el.className = "right-rail";
  container.appendChild(el);

  // Camera overlay (top of the rail) — handles its own click wiring.
  const cameraHandle = createCameraOverlay({
    container: el,
    viewport,
    getSelectionBbox,
    onFrame,
  });

  // Sections below the camera widget.
  const sectionsEl = document.createElement("div");
  sectionsEl.className = "right-rail-sections";
  sectionsEl.innerHTML = `
    <div class="right-rail-section" data-section="modes">
      <button class="rail-btn rail-mode-btn" data-mode="translate">Move</button>
      <button class="rail-btn rail-mode-btn" data-mode="rotate">Rotate</button>
      <button class="rail-btn rail-mode-btn" data-mode="scale">Scale</button>
    </div>
    <div class="right-rail-section" data-section="snap">
      <label class="rail-toggle">
        <input type="checkbox" class="rail-snap-input" />
        <span>Snap</span>
      </label>
    </div>
    <div class="right-rail-section" data-section="edit">
      <button class="rail-btn" data-action="duplicate">Duplicate</button>
      <button class="rail-btn" data-action="group">Group</button>
      <button class="rail-btn" data-action="delete">Delete</button>
    </div>
    <div class="right-rail-section" data-section="history">
      <button class="rail-btn" data-action="undo">Undo</button>
      <button class="rail-btn" data-action="redo">Redo</button>
    </div>
  `;
  el.appendChild(sectionsEl);

  const modeButtons =
    sectionsEl.querySelectorAll<HTMLButtonElement>(".rail-mode-btn");
  const snapInput =
    sectionsEl.querySelector<HTMLInputElement>(".rail-snap-input")!;
  const undoBtn =
    sectionsEl.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
  const redoBtn =
    sectionsEl.querySelector<HTMLButtonElement>('[data-action="redo"]')!;

  const onModeClick = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      ".rail-mode-btn",
    );
    if (!btn) return;
    const mode = btn.dataset.mode as ToolMode;
    onSetMode(mode);
  };

  const onActionClick = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-action]",
    );
    if (!btn) return;
    switch (btn.dataset.action) {
      case "duplicate":
        onDuplicate();
        break;
      case "group":
        onGroup();
        break;
      case "delete":
        onDelete();
        break;
      case "undo":
        onUndo();
        break;
      case "redo":
        onRedo();
        break;
    }
  };

  const onSnapChange = (): void => {
    onToggleSnap(snapInput.checked);
  };

  sectionsEl.addEventListener("click", onModeClick);
  sectionsEl.addEventListener("click", onActionClick);
  snapInput.addEventListener("change", onSnapChange);

  function setMode(mode: ToolMode): void {
    modeButtons.forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
  }

  function setSnap(snap: boolean): void {
    snapInput.checked = snap;
  }

  function setHistoryState(canUndo: boolean, canRedo: boolean): void {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  }

  // Initial state — disable history buttons until history.onChange fires.
  setHistoryState(false, false);

  return {
    setMode,
    setSnap,
    setHistoryState,
    dispose: () => {
      sectionsEl.removeEventListener("click", onModeClick);
      sectionsEl.removeEventListener("click", onActionClick);
      snapInput.removeEventListener("change", onSnapChange);
      cameraHandle.dispose();
      el.remove();
    },
  };
}
