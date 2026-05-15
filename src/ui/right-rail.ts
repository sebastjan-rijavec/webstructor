import type * as THREE from "three";
import type { Viewport } from "../scene/viewport";
import { createCameraOverlay } from "./camera-overlay";

export type ToolMode = "translate" | "rotate" | "scale";
export type ThemeName = "bright" | "dark";

const FOV_PRESETS = [10, 25, 40, 50, 75, 100] as const;

interface RightRailOptions {
  container: HTMLElement;
  viewport: Viewport;
  getSelectionBbox: () => THREE.Box3 | undefined;
  initialTheme: ThemeName;
  initialFov: number;
  onFrame: () => void;
  onSetMode: (mode: ToolMode) => void;
  onToggleSnap: (snap: boolean) => void;
  onToggleTheme: () => void;
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
  /** Sync the FOV pills with the live camera FOV. */
  setFov: (fov: number) => void;
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
    initialTheme,
    initialFov,
    onFrame,
    onSetMode,
    onToggleSnap,
    onToggleTheme,
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
    <div class="right-rail-section right-rail-section-fov" data-section="fov">
      <span class="right-rail-fov-label">FOV</span>
      ${FOV_PRESETS.map(
        (f) => `<button class="rail-btn rail-fov-btn" data-fov="${f}">${f}°</button>`,
      ).join("")}
    </div>
    <div class="right-rail-section" data-section="export">
      <button class="rail-btn rail-btn-primary" data-action="export">Export GLB</button>
    </div>
    <div class="right-rail-section" data-section="theme">
      <button class="rail-btn rail-theme-btn" data-action="theme">Dark</button>
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
  const fovButtons =
    sectionsEl.querySelectorAll<HTMLButtonElement>(".rail-fov-btn");

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
      case "theme":
        onToggleTheme();
        break;
      case "export":
        onExport();
        break;
    }
  };

  const onFovClick = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      ".rail-fov-btn",
    );
    if (!btn) return;
    const fov = Number(btn.dataset.fov);
    if (!Number.isFinite(fov)) return;
    setFov(fov);
    onSetFov(fov);
  };

  const onSnapChange = (): void => {
    onToggleSnap(snapInput.checked);
  };

  sectionsEl.addEventListener("click", onModeClick);
  sectionsEl.addEventListener("click", onActionClick);
  sectionsEl.addEventListener("click", onFovClick);
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
    // Button label points at the *destination* theme — the one that would
    // become active if the user clicks now.
    themeBtn.textContent = theme === "bright" ? "Dark" : "Bright";
  }

  function setFov(fov: number): void {
    fovButtons.forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.fov) === fov);
    });
  }

  // Initial state — disable history buttons until history.onChange fires.
  setHistoryState(false, false);
  setTheme(initialTheme);
  setFov(initialFov);

  return {
    setMode,
    setSnap,
    setTheme,
    setFov,
    setHistoryState,
    dispose: () => {
      sectionsEl.removeEventListener("click", onModeClick);
      sectionsEl.removeEventListener("click", onActionClick);
      sectionsEl.removeEventListener("click", onFovClick);
      snapInput.removeEventListener("change", onSnapChange);
      cameraHandle.dispose();
      el.remove();
    },
  };
}
