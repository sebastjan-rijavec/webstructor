import type * as THREE from "three";
import type { Viewport, ViewName } from "../scene/viewport";
import { cubeIconSvg } from "./cube-icon";

interface CameraOverlayOptions {
  container: HTMLElement;
  viewport: Viewport;
  getSelectionBbox: () => THREE.Box3 | undefined;
  onFrame: () => void;
}

interface CameraOverlayHandle {
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
  const { container, viewport, getSelectionBbox, onFrame } = opts;

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
      <span class="camera-overlay-pitch-label">PITCH</span>
      <button class="cam-btn cam-outer cam-front" data-view="front">FRONT</button>
      <button class="cam-btn cam-outer cam-back" data-view="back">BACK</button>
      <button class="cam-btn cam-outer cam-left" data-view="left">LEFT</button>
      <button class="cam-btn cam-outer cam-right" data-view="right">RIGHT</button>
      <button class="cam-btn cam-inner cam-bot" data-view="bottom">BOT</button>
      <button class="cam-btn cam-inner cam-top" data-view="top">TOP</button>
      <button class="cam-btn cam-inner cam-frame" data-action="frame">FRAME</button>
      <button class="cam-btn cam-center" data-view="perspective">3D</button>
    </div>
    <div class="camera-overlay-caption">
      <strong>ORBIT STACK</strong>
      <span>Two rings split the motion: outer = yaw, inner = pitch.</span>
    </div>
  `;
  container.appendChild(el);

  const cubeEl = el.querySelector<HTMLElement>(".camera-overlay-cube")!;
  const viewNameEl = el.querySelector<HTMLElement>(
    ".camera-overlay-view-name",
  )!;
  const viewButtons = el.querySelectorAll<HTMLButtonElement>("button[data-view]");

  let currentView: ViewName = viewport.view;

  function applyActive(view: ViewName): void {
    currentView = view;
    viewNameEl.textContent = LABEL[view];
    cubeEl.innerHTML = cubeIconSvg(view);
    viewButtons.forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
  }

  applyActive(currentView);

  const onClick = async (e: Event): Promise<void> => {
    const target = e.target as HTMLElement;
    // FRAME button — sits inside the ring, treated as a separate action.
    if (target.closest('[data-action="frame"]')) {
      onFrame();
      return;
    }
    // View button (cardinals + poles + 3D)
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
    dispose: () => {
      unsubscribeTick();
      el.removeEventListener("click", onClick);
      el.remove();
    },
  };
}
