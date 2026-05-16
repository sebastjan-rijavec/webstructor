import type * as THREE from "three";
import type { Viewport } from "../scene/viewport";
import { createCameraOverlay } from "./camera-overlay";

export type ToolMode = "translate" | "rotate" | "scale";
export type ThemeName = "bright" | "dark";

interface RightRailOptions {
  container: HTMLElement;
  viewport: Viewport;
  getSelectionBbox: () => THREE.Box3 | undefined;
  initialTheme: ThemeName;
  initialFov: number;
  initialGridVisible: boolean;
  onFrame: () => void;
  onSetMode: (mode: ToolMode) => void;
  onToggleSnap: (snap: boolean) => void;
  onToggleTheme: () => void;
  onToggleGrid: () => void;
  onSetFov: (fov: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onDelete: () => void;
  onExport: () => void;
}

interface RightRailHandle {
  /** Sync the segmented mode buttons to the current transform mode. */
  setMode: (mode: ToolMode) => void;
  /** Sync the snap toggle. */
  setSnap: (snap: boolean) => void;
  /** Update the theme button label to point at the *opposite* theme. */
  setTheme: (theme: ThemeName) => void;
  /** Sync the FOV chips with the live camera FOV (passthrough to camera overlay). */
  setFov: (fov: number) => void;
  /** Update the grid toggle button label to point at the *opposite* state. */
  setGridVisible: (visible: boolean) => void;
  /** Enable/disable Undo and Redo according to history availability. */
  setHistoryState: (canUndo: boolean, canRedo: boolean) => void;
  dispose: () => void;
}

/**
 * Right-side control rail. Top-to-bottom:
 *   1. Camera widget (outer ring = views, inner ring = FOV chips, center
 *      = 3D, FRAME pill below — all owned by camera-overlay.ts per #28)
 *   2. 3-column row: Mode (Move/Rotate/Scale stacked) | Edit (Duplicate/
 *      Group/Delete stacked) | Snap (tall pill spanning both columns)
 *   3. Undo / Redo
 *   4. Theme toggle / Grid toggle
 *
 * Visible spacing between each group via .right-rail-sections gap.
 */
export function createRightRail(opts: RightRailOptions): RightRailHandle {
  const {
    container,
    viewport,
    getSelectionBbox,
    initialTheme,
    initialFov,
    initialGridVisible,
    onFrame,
    onSetMode,
    onToggleSnap,
    onToggleTheme,
    onToggleGrid,
    onSetFov,
    onUndo,
    onRedo,
    onDuplicate,
    onGroup,
    onDelete,
    onExport,
  } = opts;

  const el = document.createElement("div");
  el.className = "right-rail";
  container.appendChild(el);

  // Camera widget owns FRAME + FOV (per #28: outer ring = views, inner = FOV).
  const cameraHandle = createCameraOverlay({
    container: el,
    viewport,
    getSelectionBbox,
    initialFov,
    onFrame,
    onSetFov,
  });

  const sectionsEl = document.createElement("div");
  sectionsEl.className = "right-rail-sections";
  sectionsEl.innerHTML = `
    <div class="right-rail-group right-rail-grid">
      <div class="right-rail-col">
        <button class="rail-btn rail-mode-btn" data-mode="translate">Move</button>
        <button class="rail-btn rail-mode-btn" data-mode="rotate">Rotate</button>
        <button class="rail-btn rail-mode-btn" data-mode="scale">Scale</button>
      </div>
      <div class="right-rail-col">
        <button class="rail-btn" data-action="duplicate">Duplicate</button>
        <button class="rail-btn" data-action="group">Group</button>
        <button class="rail-btn" data-action="delete">Delete</button>
      </div>
      <label class="rail-snap-tall">
        <input type="checkbox" class="rail-snap-input" />
        <span>Snap</span>
      </label>
    </div>
    <div class="right-rail-group">
      <div class="right-rail-row">
        <button class="rail-btn" data-action="undo">Undo</button>
        <button class="rail-btn" data-action="redo">Redo</button>
      </div>
    </div>
    <div class="right-rail-group">
      <div class="right-rail-row">
        <button class="rail-btn rail-theme-btn" data-action="theme">Dark</button>
        <button class="rail-btn rail-grid-btn" data-action="grid">Hide Grid</button>
      </div>
    </div>
    <div class="right-rail-group">
      <button class="rail-download-btn" data-action="export">Download GLB</button>
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
  const themeBtn =
    sectionsEl.querySelector<HTMLButtonElement>('[data-action="theme"]')!;
  const gridBtn =
    sectionsEl.querySelector<HTMLButtonElement>('[data-action="grid"]')!;

  const onModeClick = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      ".rail-mode-btn",
    );
    if (!btn) return;
    onSetMode(btn.dataset.mode as ToolMode);
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
      case "theme":
        onToggleTheme();
        break;
      case "grid":
        onToggleGrid();
        break;
      case "export":
        onExport();
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

  function setTheme(theme: ThemeName): void {
    themeBtn.textContent = theme === "bright" ? "Dark" : "Bright";
  }

  function setFov(fov: number): void {
    cameraHandle.setFov(fov);
  }

  function setGridVisible(visible: boolean): void {
    gridBtn.textContent = visible ? "Hide Grid" : "Show Grid";
  }

  setHistoryState(false, false);
  setTheme(initialTheme);
  setGridVisible(initialGridVisible);

  return {
    setMode,
    setSnap,
    setTheme,
    setFov,
    setGridVisible,
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
