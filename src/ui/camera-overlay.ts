import type * as THREE from "three";
import type { Viewport, ViewName } from "../scene/viewport";
import { cubeIconSvg } from "./cube-icon";

interface CameraOverlayOptions {
  container: HTMLElement;
  viewport: Viewport;
  getSelectionBbox: () => THREE.Box3 | undefined;
  initialFov: number;
  onFrame: () => void;
  onSetFov: (fov: number) => void;
}

interface CameraOverlayHandle {
  /** Sync the active FOV chip when something else drives camera.fov. */
  setFov: (fov: number) => void;
  dispose: () => void;
}

const LABEL: Record<ViewName, string> = {
  perspective: "3D",
  front: "FRONT",
  back: "BACK",
  left: "LEFT",
  right: "RIGHT",
  top: "TOP",
  bottom: "BOT",
};

// Per issue #28, all 6 view buttons live on the outer ring; FOV moves to
// the inner ring. FOV chips clockwise from N at 60° intervals so the values
// sweep visually in order.
const FOV_INNER = [10, 25, 40, 50, 75, 100] as const;

/**
 * Radial camera overlay — mounts inside `container` (typically the relatively-
 * positioned viewport wrapper). Snaps the camera to the clicked view and
 * reflects the viewport's live view in the header label + active button. The
 * old toolbar continues to drive `viewport.setView` in parallel; this overlay
 * stays in sync by polling `viewport.view` on each frame.
 */
export function createCameraOverlay(
  opts: CameraOverlayOptions,
): CameraOverlayHandle {
  const { container, viewport, getSelectionBbox, initialFov, onFrame, onSetFov } =
    opts;

  // Inner-ring FOV chips, generated dynamically so the layout slot
  // (cam-fov-i0 .. cam-fov-i5) carries the angular position via CSS.
  const fovChipsHtml = FOV_INNER.map(
    (fov, i) =>
      `<button class="cam-btn cam-inner cam-fov cam-fov-i${i}" data-fov="${fov}">${fov}°</button>`,
  ).join("");

  const el = document.createElement("div");
  el.className = "camera-overlay";
  el.innerHTML = `
    <div class="camera-overlay-cube"></div>
    <div class="camera-overlay-header">
      <span class="camera-overlay-dot"></span>
      VIEW <strong class="camera-overlay-view-name">3D</strong>
    </div>
    <div class="camera-overlay-ring">
      <div class="camera-overlay-outer-ring"></div>
      <div class="camera-overlay-inner-ring"></div>
      <button class="cam-btn cam-outer cam-front" data-view="front">FRONT</button>
      <button class="cam-btn cam-outer cam-back" data-view="back">BACK</button>
      <button class="cam-btn cam-outer cam-left" data-view="left">LEFT</button>
      <button class="cam-btn cam-outer cam-right" data-view="right">RIGHT</button>
      <button class="cam-btn cam-outer cam-bot" data-view="bottom">BOT</button>
      <button class="cam-btn cam-outer cam-top" data-view="top">TOP</button>
      ${fovChipsHtml}
      <button class="cam-btn cam-center" data-view="perspective">3D</button>
    </div>
    <button class="camera-overlay-frame" data-action="frame">FRAME</button>
  `;
  container.appendChild(el);

  const cubeEl = el.querySelector<HTMLElement>(".camera-overlay-cube")!;
  const viewNameEl = el.querySelector<HTMLElement>(
    ".camera-overlay-view-name",
  )!;
  const viewButtons = el.querySelectorAll<HTMLButtonElement>("button[data-view]");
  const fovButtons = el.querySelectorAll<HTMLButtonElement>(".cam-fov");

  let currentView: ViewName = viewport.view;

  function applyActive(view: ViewName): void {
    currentView = view;
    viewNameEl.textContent = LABEL[view];
    cubeEl.innerHTML = cubeIconSvg(view);
    viewButtons.forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
  }

  function setFov(fov: number): void {
    fovButtons.forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.fov) === fov);
    });
  }

  applyActive(currentView);
  setFov(initialFov);

  const onClick = async (e: Event): Promise<void> => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-action="frame"]')) {
      onFrame();
      return;
    }
    const fovBtn = target.closest<HTMLButtonElement>(".cam-fov");
    if (fovBtn) {
      const fov = Number(fovBtn.dataset.fov);
      if (Number.isFinite(fov)) {
        setFov(fov);
        onSetFov(fov);
      }
      return;
    }
    const viewBtn = target.closest<HTMLButtonElement>("button[data-view]");
    if (!viewBtn) return;
    const v = viewBtn.dataset.view as ViewName;
    if (v === viewport.view) return;
    applyActive(v);
    await viewport.setView(v, getSelectionBbox());
  };
  el.addEventListener("click", onClick);

  // Keep the overlay in sync when another UI drives the view. Polling on
  // tick is cheap — a single string compare per frame.
  const unsubscribeTick = viewport.onTick(() => {
    if (viewport.view !== currentView) applyActive(viewport.view);
  });

  return {
    setFov,
    dispose: () => {
      unsubscribeTick();
      el.removeEventListener("click", onClick);
      el.remove();
    },
  };
}
