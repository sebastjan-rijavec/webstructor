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
  /** Set the floor grid's opacity (0..1). Used by the theme system to
   * tone the grid down on dark backgrounds where the default reads as
   * over-bright. */
  setGridOpacity: (opacity: number) => void;
  /** Show/hide the floor grid entirely (independent of opacity). */
  setGridVisible: (visible: boolean) => void;
  readonly view: ViewName;
  /** Switch to a named view with an ease-in-out animation along an arc.
   * If `bbox` is provided, the camera fits to that bbox at the end of the
   * animation; otherwise it fits to all content in `root`. */
  setView: (view: ViewName, bbox?: THREE.Box3) => Promise<void>;
  /** Set the camera FOV (degrees) immediately. */
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
  /** Optional intermediate waypoint for non-adjacent axis transitions. */
  via: ArcSample | null;
  end: ArcSample;
  endTarget: ViewTarget;
  startTime: number;
  duration: number;
  wasDamping: boolean;
  resolve: () => void;
}

type AxisView = Exclude<ViewName, "perspective">;

/**
 * Equator-first adjacency graph for camera view transitions.
 *
 * - FRONT/RIGHT/BACK/LEFT form an equator ring.
 * - TOP and BOTTOM connect to FRONT, LEFT, RIGHT — but NOT to BACK. Going
 *   from a pole to BACK always routes through LEFT or RIGHT, since rolling
 *   directly over the scene from a pole to its "behind" side reads as
 *   disorienting.
 * - TOP and BOTTOM are not directly connected to each other.
 *
 * Diameter is 2, so every transition needs at most one intermediate.
 */
const ADJACENCY: Record<AxisView, readonly AxisView[]> = {
  front: ["right", "left", "top", "bottom"],
  back: ["right", "left"],
  left: ["front", "back", "top", "bottom"],
  right: ["front", "back", "top", "bottom"],
  top: ["front", "left", "right"],
  bottom: ["front", "left", "right"],
};

/** Unit direction from orbit-target to camera position for each axis view. */
const VIEW_AXIS: Record<AxisView, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
};

/**
 * All shortest paths from `from` to `to` in the view adjacency graph,
 * returned as the sequence of intermediates between them (excluding both
 * endpoints). `[[]]` means direct adjacency (no intermediate); the empty
 * outer array would mean unreachable (cannot happen in this graph).
 */
function shortestIntermediates(from: AxisView, to: AxisView): AxisView[][] {
  if (from === to) return [[]];
  if (ADJACENCY[from].includes(to)) return [[]];
  const result: AxisView[][] = [];
  for (const m of ADJACENCY[from]) {
    if (ADJACENCY[m].includes(to)) result.push([m]);
  }
  return result;
}

/**
 * Pick the via-view from candidate intermediates whose axis direction is
 * closest to the current camera direction (largest dot product). For pole→
 * back transitions the candidates are equidistant from the pole, so the
 * camera's current position acts as the deterministic tiebreaker.
 */
function pickVia(
  candidates: AxisView[][],
  currentDir: THREE.Vector3,
): AxisView | null {
  if (candidates.length === 0 || candidates[0].length === 0) return null;
  let best: AxisView = candidates[0][0];
  let bestScore = VIEW_AXIS[best].dot(currentDir);
  for (let i = 1; i < candidates.length; i++) {
    const m = candidates[i][0];
    const score = VIEW_AXIS[m].dot(currentDir);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
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
    // Logarithmic depth buffer keeps precision uniform across the near/far
    // range. Fixes the z-fighting shimmer that shows up at narrow FOVs
    // (FOV 10° dollies the camera ~5× further out, magnifying coincident
    // geometry in the GLB detail assets).
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef0f4);

  // Image-based lighting: drive PBR reflections/diffuse from a synthetic
  // RoomEnvironment. No external HDRI asset needed; PMREM-prefiltered once.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // near=0.1 (not 0.01) — 10× more depth-buffer precision for a typical
  // kitbash scene. Combined with logarithmicDepthBuffer above this removes
  // the narrow-FOV z-fighting on coincident GLB geometry.
  const camera = new THREE.PerspectiveCamera(INITIAL_FOV, 1, 0.1, 1000);
  camera.position.set(4, 3, 6);
  camera.lookAt(0, 0.5, 0);

  let view: ViewName = "perspective";

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.5, 0);

  // Sun — warm, intense directional light casting real shadows. The IBL
  // still provides indirect diffuse and reflections; the sun adds the
  // dominant key + shadows so the scene reads as outdoor / lit.
  //
  // Softness comes from a wider PCF kernel (shadow.radius) on top of
  // PCFSoftShadowMap, not from the light position — position stays at
  // the original high angle.
  const dir = new THREE.DirectionalLight(0xfff4d6, 3.0);
  dir.position.set(8, 12, 6);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.bias = -0.0005;
  dir.shadow.radius = 6; // PCF kernel radius — higher = softer penumbra
  // Orthographic shadow camera sized for a typical kitbash scene. Increase
  // these bounds (and the resolution above) if large assets clip out of
  // the shadow frustum.
  dir.shadow.camera.left = -20;
  dir.shadow.camera.right = 20;
  dir.shadow.camera.top = 20;
  dir.shadow.camera.bottom = -20;
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 60;
  scene.add(dir);

  const fill = new THREE.DirectionalLight(0xa3c4ff, 0.35);
  fill.position.set(-6, 3, -4);
  scene.add(fill);

  // Helpers (grid + axes + selection outlines) — not exported.
  const helpers = new THREE.Group();
  helpers.name = "__helpers";
  const grid = new THREE.GridHelper(20, 20, 0xa3a8b2, 0xc8ccd4);
  const gridMaterial = grid.material as THREE.Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.85;
  helpers.add(grid);

  function setGridOpacity(opacity: number): void {
    gridMaterial.opacity = opacity;
  }

  function setGridVisible(visible: boolean): void {
    grid.visible = visible;
  }
  const axes = new THREE.AxesHelper(0.5);
  helpers.add(axes);

  // Invisible shadow catcher at Y=0 — receives sun shadows so the cast
  // shadow shows up on the ground plane. ShadowMaterial draws nothing
  // except the shadow itself.
  //   - depthWrite: false   so the catcher doesn't occlude the grid (which
  //     is coplanar at Y=0) or the bottom faces of objects sitting on the
  //     ground. Default for transparent materials is depthWrite:true,
  //     which writes Y=0 depths and hides anything else at the same plane.
  //   - position Y=-0.001   defensive nudge to keep the catcher beneath
  //     anything authored exactly at Y=0.
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.28, depthWrite: false }),
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -0.001;
  shadowCatcher.receiveShadow = true;
  shadowCatcher.name = "__shadowCatcher";
  helpers.add(shadowCatcher);

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

  function setView(targetView: ViewName, bbox?: THREE.Box3): Promise<void> {
    return new Promise<void>((resolve) => {
      const fromView = view;
      if (animState) {
        finalizeAnim(animState);
        animState = null;
      }
      const fovForFit = camera.fov;

      // Single-phase animation: arc + dolly happen together. When a bbox is
      // provided, the camera flies directly to the selection-framed target;
      // otherwise it frames the whole scene.
      const padding = bbox ? FRAME_PADDING : VIEW_PADDING;
      const finalTarget = computeViewTarget(
        targetView,
        fovForFit,
        bbox,
        padding,
      );

      const startOffset = camera.position.clone().sub(controls.target);
      const startRadius = Math.max(startOffset.length(), 0.01);
      const start: ArcSample = {
        dir: startOffset.divideScalar(startRadius),
        radius: startRadius,
        up: camera.up.clone().normalize(),
        orbitTarget: controls.target.clone(),
      };

      // Equator-first shortest-path: at most one intermediate. Skip the
      // lookup if either endpoint is `perspective` (handled as single-arc)
      // or the view didn't change.
      let viaName: AxisView | null = null;
      if (
        fromView !== "perspective" &&
        targetView !== "perspective" &&
        fromView !== targetView
      ) {
        const candidates = shortestIntermediates(fromView, targetView);
        const currentDir = camera.position
          .clone()
          .sub(controls.target)
          .normalize();
        viaName = pickVia(candidates, currentDir);
      }
      const via = viaName
        ? sampleFromTarget(
            computeViewTarget(viaName, fovForFit, bbox, padding),
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
        end: sampleFromTarget(finalTarget),
        endTarget: finalTarget,
        startTime: performance.now(),
        duration: VIEW_TRANSITION_MS,
        wasDamping,
        resolve,
      };
    });
  }

  function finalizeAnim(s: AnimState) {
    camera.up.copy(s.endTarget.up);
    camera.position.copy(s.endTarget.position);
    camera.lookAt(s.endTarget.orbitTarget);
    controls.target.copy(s.endTarget.orbitTarget);
    controls.enabled = true;
    controls.enableDamping = s.wasDamping;
    s.resolve();
  }

  const tmpTarget = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function stepAnim() {
    if (!animState) return;
    const s = animState;
    const elapsed = performance.now() - s.startTime;
    if (elapsed >= s.duration) {
      finalizeAnim(s);
      animState = null;
      return;
    }
    const k = easeInOutCubic(elapsed / s.duration);

    // Orbit target lerps linearly — typically a fixed point.
    tmpTarget.copy(s.start.orbitTarget).lerp(s.end.orbitTarget, k);

    let radius: number;
    if (s.via) {
      // Spherical quadratic Bezier (De Casteljau of slerps) through
      // start.dir, via.dir, end.dir. The curve bulges toward via without
      // making a hard corner there — fixes the tangent discontinuity that
      // made BACK→TOP feel harsh.
      slerpVec(tmpA, s.start.dir, s.via.dir, k);
      slerpVec(tmpB, s.via.dir, s.end.dir, k);
      slerpVec(tmpDir, tmpA, tmpB, k);
      // Same Bezier on the up vector. Critical for pole↔pole transitions
      // (BOTTOM↔TOP): start.up and end.up are antipodal there, so a global
      // start→end slerp would fall into slerpVec's antipodal branch and
      // rotate through an arbitrary perpendicular axis — flipping the
      // camera upside-down at the midpoint. Routing via.up (world up at
      // FRONT) gives a clean great-circle path with no flip.
      slerpVec(tmpA, s.start.up, s.via.up, k);
      slerpVec(tmpB, s.via.up, s.end.up, k);
      slerpVec(tmpUp, tmpA, tmpB, k);
      // Scalar quadratic Bezier for radius — matches the position curve's
      // C1 continuity so dolly speed doesn't pop at the waypoint either.
      const ra = s.start.radius + (s.via.radius - s.start.radius) * k;
      const rb = s.via.radius + (s.end.radius - s.via.radius) * k;
      radius = ra + (rb - ra) * k;
    } else {
      slerpVec(tmpDir, s.start.dir, s.end.dir, k);
      slerpVec(tmpUp, s.start.up, s.end.up, k);
      radius = s.start.radius + (s.end.radius - s.start.radius) * k;
    }

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
      const fovRad = (camera.fov * Math.PI) / 180;
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
        startTime: performance.now(),
        duration: FRAME_TRANSITION_MS,
        wasDamping,
        resolve,
      };
    });
  }

  function setFov(targetFov: number): Promise<void> {
    if (Math.abs(camera.fov - targetFov) >= 0.001) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
    return Promise.resolve();
  }

  const tickCallbacks = new Set<() => void>();
  let running = true;
  function tick() {
    if (!running) return;
    stepAnim();
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
    setGridOpacity,
    setGridVisible,
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
