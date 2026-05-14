import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type ViewName =
  | "perspective"
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom";

export interface Viewport {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Root group containing all user-created kitbash content (everything that gets exported). */
  root: THREE.Group;
  /** Helpers (grid, axes, selection outlines) that should NOT be exported. */
  helpers: THREE.Group;
  readonly view: ViewName;
  /** Switch to a named view with an ease-in-out animation along an arc.
   * If `bbox` is provided, the camera fits to that bbox at the end of the
   * animation; otherwise it fits to all content in `root`. */
  setView: (view: ViewName, bbox?: THREE.Box3) => Promise<void>;
  /** Animate the camera FOV to the given value (degrees). */
  setFov: (fov: number) => Promise<void>;
  /** Re-center and re-zoom the camera so the given bbox fills the frame.
   * Keeps the current view direction. */
  frame: (bbox: THREE.Box3) => Promise<void>;
  /** Register a callback invoked once per frame before rendering. Returns unsubscribe. */
  onTick: (fn: () => void) => () => void;
  dispose: () => void;
}

const VIEW_TRANSITION_MS = 1800;
const FRAME_TRANSITION_MS = 800;
const FOV_TRANSITION_MS = 600;
const INITIAL_FOV = 50;
// PADDING used when fitting the whole scene (root bbox) at a named view.
const VIEW_PADDING = 1.15;
// PADDING used when fitting the selection at the end of a framed view-switch
// or a standalone Frame action. Larger than VIEW_PADDING so the dolly target
// leaves breathing room — both for visual comfort and to compensate for the
// dolly-start velocity inherited from the rotation phase.
const FRAME_PADDING = 1.6;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Spherical linear interpolation for unit vectors. Used to move the camera
 * along an arc around the orbit target instead of a straight line through it.
 */
function slerpVec(
  out: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  if (dot > 0.9995) {
    return out.lerpVectors(a, b, t).normalize();
  }
  if (dot < -0.9995) {
    // Antipodal — pick an arbitrary perpendicular axis and rotate through it
    // so the path doesn't collapse to a point.
    const axis =
      Math.abs(a.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
    axis.cross(a).normalize();
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI * t);
    return out.copy(a).applyQuaternion(quat);
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wA = Math.sin((1 - t) * theta) / sinTheta;
  const wB = Math.sin(t * theta) / sinTheta;
  out.copy(a).multiplyScalar(wA);
  out.addScaledVector(b, wB);
  return out;
}

interface ViewTarget {
  position: THREE.Vector3;
  up: THREE.Vector3;
  orbitTarget: THREE.Vector3;
}

interface ArcSample {
  dir: THREE.Vector3;
  radius: number;
  up: THREE.Vector3;
  orbitTarget: THREE.Vector3;
}

interface AnimState {
  start: ArcSample;
  /** Great-circle waypoint for antipodal/degenerate axis transitions. */
  via: ArcSample | null;
  /** Mid-point: root-framed at the target angle. Animation reaches this at the
   * halfway mark when `frameEnd` is non-null, otherwise at t=1. */
  end: ArcSample;
  endTarget: ViewTarget;
  /** Optional second-half target: selection-framed at the target angle.
   * When set, the animation dollies from `end` to `frameEnd` in the second
   * half — same direction, different radius. */
  frameEnd: ArcSample | null;
  frameEndTarget: ViewTarget | null;
  startTime: number;
  duration: number;
  wasDamping: boolean;
  resolve: () => void;
}

interface FovAnimState {
  startFov: number;
  endFov: number;
  startTime: number;
  resolve: () => void;
}

/**
 * For antipodal axis-pair transitions, force the camera through a specific
 * intermediate view so it sweeps along a clean great circle instead of taking
 * an arbitrary path. All entries here are pairs whose start/via/end are on a
 * single great circle, so each leg is a 90° slerp and the velocity at the
 * waypoint is continuous.
 */
const VIEW_WAYPOINTS: { [from in ViewName]?: { [to in ViewName]?: ViewName } } =
  {
    front: { back: "right" },
    back: { front: "right", bottom: "right", top: "right" },
    left: { right: "front" },
    right: { left: "front" },
    top: { bottom: "front", back: "right" },
    bottom: { top: "front", back: "right" },
  };

function getWaypoint(from: ViewName, to: ViewName): ViewName | null {
  return VIEW_WAYPOINTS[from]?.[to] ?? null;
}

function sampleFromTarget(t: ViewTarget): ArcSample {
  const offset = t.position.clone().sub(t.orbitTarget);
  const radius = Math.max(offset.length(), 0.01);
  return {
    dir: offset.divideScalar(radius),
    radius,
    up: t.up.clone().normalize(),
    orbitTarget: t.orbitTarget.clone(),
  };
}

export function createViewport(canvas: HTMLCanvasElement): Viewport {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef0f4);

  // Image-based lighting: drive PBR reflections/diffuse from a synthetic
  // RoomEnvironment. No external HDRI asset needed; PMREM-prefiltered once.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(INITIAL_FOV, 1, 0.01, 1000);
  camera.position.set(4, 3, 6);
  camera.lookAt(0, 0.5, 0);

  let view: ViewName = "perspective";

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.5, 0);

  // Direct lights complement the IBL — they add a key highlight + soft fill,
  // so they're toned down compared to the previous pure-direct setup.
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(5, 8, 6);
  scene.add(dir);

  const fill = new THREE.DirectionalLight(0xa3c4ff, 0.25);
  fill.position.set(-6, 3, -4);
  scene.add(fill);

  // Helpers (grid + axes + selection outlines) — not exported.
  const helpers = new THREE.Group();
  helpers.name = "__helpers";
  const grid = new THREE.GridHelper(20, 20, 0xa3a8b2, 0xc8ccd4);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.85;
  helpers.add(grid);
  const axes = new THREE.AxesHelper(0.5);
  helpers.add(axes);
  scene.add(helpers);

  // Root content group — this is what gets exported.
  const root = new THREE.Group();
  root.name = "Scene";
  scene.add(root);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  function computeViewTarget(
    name: ViewName,
    fovForFit: number,
    explicitBbox?: THREE.Box3,
    padding: number = VIEW_PADDING,
  ): ViewTarget {
    const bbox = explicitBbox ?? new THREE.Box3().setFromObject(root);
    if (bbox.isEmpty()) {
      bbox.set(
        new THREE.Vector3(-2.5, 0, -2.5),
        new THREE.Vector3(2.5, 5, 2.5),
      );
    }
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const aspect =
      canvas.clientWidth / Math.max(1, canvas.clientHeight);

    /** Distance from the bbox center such that the bbox cross-section
     * (contentW × contentH) fits the frame *at the near-face plane* — i.e.,
     * we frame against the closest face of the bbox, not its center, since
     * that's what dominates perspective foreshortening. */
    function distFor(
      contentW: number,
      contentH: number,
      halfDepth: number,
    ): number {
      const cW = Math.max(contentW, 0.01) * padding;
      const cH = Math.max(contentH, 0.01) * padding;
      const visibleH = Math.max(cH, cW / aspect);
      const fovRad = (fovForFit * Math.PI) / 180;
      const framingDistAtNear = visibleH / (2 * Math.tan(fovRad / 2));
      return halfDepth + framingDistAtNear;
    }

    function build(
      axis: THREE.Vector3,
      up: THREE.Vector3,
      contentW: number,
      contentH: number,
      halfDepth: number,
    ): ViewTarget {
      const d = distFor(contentW, contentH, halfDepth);
      return {
        position: center.clone().add(axis.clone().multiplyScalar(d)),
        up,
        orbitTarget: center.clone(),
      };
    }

    switch (name) {
      case "perspective": {
        const radius = Math.max(size.length() / 2, 0.5);
        const fovRad = (fovForFit * Math.PI) / 180;
        const distP = (radius / Math.sin(fovRad / 2)) * padding;
        const direction = new THREE.Vector3(1, 0.6, 1.4).normalize();
        return {
          position: center.clone().add(direction.multiplyScalar(distP)),
          up: new THREE.Vector3(0, 1, 0),
          orbitTarget: center.clone(),
        };
      }
      case "front":
        return build(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(0, 1, 0),
          size.x,
          size.y,
          size.z / 2,
        );
      case "back":
        return build(
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(0, 1, 0),
          size.x,
          size.y,
          size.z / 2,
        );
      case "right":
        return build(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 1, 0),
          size.z,
          size.y,
          size.x / 2,
        );
      case "left":
        return build(
          new THREE.Vector3(-1, 0, 0),
          new THREE.Vector3(0, 1, 0),
          size.z,
          size.y,
          size.x / 2,
        );
      case "top":
        return build(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0, 0, -1),
          size.x,
          size.z,
          size.y / 2,
        );
      case "bottom":
        return build(
          new THREE.Vector3(0, -1, 0),
          new THREE.Vector3(0, 0, 1),
          size.x,
          size.z,
          size.y / 2,
        );
    }
  }

  let animState: AnimState | null = null;
  let fovAnimState: FovAnimState | null = null;

  function setView(targetView: ViewName, bbox?: THREE.Box3): Promise<void> {
    return new Promise<void>((resolve) => {
      const fromView = view;
      if (animState) {
        finalizeAnim(animState);
        animState = null;
      }
      // Fit using the FOV the user is targeting — if a FOV animation is in
      // flight, use its end value so the final frame is correct.
      const fovForFit = fovAnimState ? fovAnimState.endFov : camera.fov;

      // The "rotate then frame" split is only useful when the framing scale
      // actually changes — which is the case for 3D ↔ axis transitions (3D
      // default frames the whole scene; axis lands close on the selection).
      // For axis ↔ axis the camera is already close to the selection, so we
      // do a single-phase rotation around the selection (no zoom-out detour).
      const involvesPerspective =
        fromView === "perspective" || targetView === "perspective";
      const splitFraming = bbox != null && involvesPerspective;

      // Bbox/padding used by the rotation phase (and any waypoint along it):
      // - split: root-framed (so user sees the scene during the rotation,
      //   then dollies into the selection in phase 2).
      // - axis↔axis with selection: selection-framed throughout — the camera
      //   orbits around the selection at constant radius.
      // - no selection: root-framed.
      const rotationBbox = splitFraming ? undefined : bbox;
      const rotationPadding =
        bbox && !splitFraming ? FRAME_PADDING : VIEW_PADDING;

      const rotationEnd = computeViewTarget(
        targetView,
        fovForFit,
        rotationBbox,
        rotationPadding,
      );
      const finalTarget = splitFraming
        ? computeViewTarget(targetView, fovForFit, bbox, FRAME_PADDING)
        : rotationEnd;

      const startOffset = camera.position.clone().sub(controls.target);
      const startRadius = Math.max(startOffset.length(), 0.01);
      const start: ArcSample = {
        dir: startOffset.divideScalar(startRadius),
        radius: startRadius,
        up: camera.up.clone().normalize(),
        orbitTarget: controls.target.clone(),
      };

      const waypointName = getWaypoint(fromView, targetView);
      const via = waypointName
        ? sampleFromTarget(
            computeViewTarget(
              waypointName,
              fovForFit,
              rotationBbox,
              rotationPadding,
            ),
          )
        : null;

      view = targetView;
      // Lock orbit-rotate for the 6 axis views; pan + zoom remain.
      controls.enableRotate = view === "perspective";

      // Freeze interaction + damping for the duration of the transition so
      // residual input deltas don't fight the animated camera.
      const wasDamping = controls.enableDamping;
      controls.enabled = false;
      controls.enableDamping = false;

      animState = {
        start,
        via,
        end: sampleFromTarget(rotationEnd),
        endTarget: rotationEnd,
        frameEnd: splitFraming ? sampleFromTarget(finalTarget) : null,
        frameEndTarget: splitFraming ? finalTarget : null,
        startTime: performance.now(),
        duration: VIEW_TRANSITION_MS,
        wasDamping,
        resolve,
      };
    });
  }

  function finalizeAnim(s: AnimState) {
    const finalTarget = s.frameEndTarget ?? s.endTarget;
    camera.up.copy(finalTarget.up);
    camera.position.copy(finalTarget.position);
    camera.lookAt(finalTarget.orbitTarget);
    controls.target.copy(finalTarget.orbitTarget);
    controls.enabled = true;
    controls.enableDamping = s.wasDamping;
    s.resolve();
  }

  const tmpTarget = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();

  function stepAnim() {
    if (!animState) return;
    const s = animState;
    const elapsed = performance.now() - s.startTime;
    if (elapsed >= s.duration) {
      finalizeAnim(s);
      animState = null;
      return;
    }
    const tRaw = elapsed / s.duration;

    let segStart: ArcSample;
    let segEnd: ArcSample;
    let segK: number;

    if (s.frameEnd) {
      // Split animation: each phase eases independently so both start AND end
      // with zero velocity. The camera pauses momentarily at the rough-framed
      // view before dollying into the selection.
      if (tRaw < 0.5) {
        const phaseK = easeInOutCubic(tRaw * 2);
        if (s.via) {
          if (phaseK < 0.5) {
            segStart = s.start;
            segEnd = s.via;
            segK = phaseK * 2;
          } else {
            segStart = s.via;
            segEnd = s.end;
            segK = (phaseK - 0.5) * 2;
          }
        } else {
          segStart = s.start;
          segEnd = s.end;
          segK = phaseK;
        }
      } else {
        segStart = s.end;
        segEnd = s.frameEnd;
        segK = easeInOutCubic((tRaw - 0.5) * 2);
      }
    } else {
      // No framing split: single eased curve across the whole transition.
      const k = easeInOutCubic(tRaw);
      if (s.via) {
        if (k < 0.5) {
          segStart = s.start;
          segEnd = s.via;
          segK = k * 2;
        } else {
          segStart = s.via;
          segEnd = s.end;
          segK = (k - 0.5) * 2;
        }
      } else {
        segStart = s.start;
        segEnd = s.end;
        segK = k;
      }
    }

    tmpTarget.copy(segStart.orbitTarget).lerp(segEnd.orbitTarget, segK);
    slerpVec(tmpDir, segStart.dir, segEnd.dir, segK);
    slerpVec(tmpUp, segStart.up, segEnd.up, segK);
    const radius = segStart.radius + (segEnd.radius - segStart.radius) * segK;

    camera.up.copy(tmpUp);
    camera.position.copy(tmpTarget).addScaledVector(tmpDir, radius);
    camera.lookAt(tmpTarget);
    controls.target.copy(tmpTarget);
  }

  function frame(bbox: THREE.Box3): Promise<void> {
    return new Promise<void>((resolve) => {
      if (bbox.isEmpty()) {
        resolve();
        return;
      }
      if (animState) {
        finalizeAnim(animState);
        animState = null;
      }
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const radius = Math.max(size.length() / 2, 0.5);
      const fovForFit = fovAnimState ? fovAnimState.endFov : camera.fov;
      const fovRad = (fovForFit * Math.PI) / 180;
      const distance = (radius / Math.sin(fovRad / 2)) * FRAME_PADDING;

      const currentOffset = camera.position.clone().sub(controls.target);
      const currentRadius = Math.max(currentOffset.length(), 0.01);
      const currentDir = currentOffset.clone().divideScalar(currentRadius);

      const target: ViewTarget = {
        position: center.clone().addScaledVector(currentDir, distance),
        up: camera.up.clone(),
        orbitTarget: center.clone(),
      };

      const start: ArcSample = {
        dir: currentDir,
        radius: currentRadius,
        up: camera.up.clone().normalize(),
        orbitTarget: controls.target.clone(),
      };

      const wasDamping = controls.enableDamping;
      controls.enabled = false;
      controls.enableDamping = false;

      animState = {
        start,
        via: null,
        end: sampleFromTarget(target),
        endTarget: target,
        frameEnd: null,
        frameEndTarget: null,
        startTime: performance.now(),
        duration: FRAME_TRANSITION_MS,
        wasDamping,
        resolve,
      };
    });
  }

  function setFov(targetFov: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (fovAnimState) {
        // Snap current FOV animation to its target so the new one starts clean.
        camera.fov = fovAnimState.endFov;
        camera.updateProjectionMatrix();
        fovAnimState.resolve();
        fovAnimState = null;
      }
      if (Math.abs(camera.fov - targetFov) < 0.001) {
        resolve();
        return;
      }
      fovAnimState = {
        startFov: camera.fov,
        endFov: targetFov,
        startTime: performance.now(),
        resolve,
      };
    });
  }

  function stepFovAnim() {
    if (!fovAnimState) return;
    const s = fovAnimState;
    const elapsed = performance.now() - s.startTime;
    if (elapsed >= FOV_TRANSITION_MS) {
      camera.fov = s.endFov;
      camera.updateProjectionMatrix();
      s.resolve();
      fovAnimState = null;
      return;
    }
    const k = easeInOutCubic(elapsed / FOV_TRANSITION_MS);
    camera.fov = s.startFov + (s.endFov - s.startFov) * k;
    camera.updateProjectionMatrix();
  }

  const tickCallbacks = new Set<() => void>();
  let running = true;
  function tick() {
    if (!running) return;
    stepAnim();
    stepFovAnim();
    controls.update();
    for (const fn of tickCallbacks) fn();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    renderer,
    scene,
    camera,
    controls,
    root,
    helpers,
    get view() {
      return view;
    },
    setView,
    setFov,
    frame,
    onTick(fn) {
      tickCallbacks.add(fn);
      return () => tickCallbacks.delete(fn);
    },
    dispose() {
      running = false;
      ro.disconnect();
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
