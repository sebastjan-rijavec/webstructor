import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface Viewport {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Root group containing all user-created kitbash content (everything that gets exported). */
  root: THREE.Group;
  /** Helpers (grid, lights gizmos) that should NOT be exported. */
  helpers: THREE.Group;
  dispose: () => void;
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
  scene.background = new THREE.Color(0x202024);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
  camera.position.set(4, 3, 6);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.5, 0);

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x303038, 0.55);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(5, 8, 6);
  scene.add(dir);

  const fill = new THREE.DirectionalLight(0xa3c4ff, 0.35);
  fill.position.set(-6, 3, -4);
  scene.add(fill);

  // Helpers (grid + axes) — not exported.
  const helpers = new THREE.Group();
  helpers.name = "__helpers";
  const grid = new THREE.GridHelper(20, 20, 0x444450, 0x2e2e34);
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
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let running = true;
  function tick() {
    if (!running) return;
    controls.update();
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
    dispose() {
      running = false;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}
