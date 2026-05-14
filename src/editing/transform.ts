import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type TransformMode = "translate" | "rotate" | "scale";

export interface TransformOptions {
  camera: THREE.Camera;
  domElement: HTMLElement;
  scene: THREE.Scene;
  orbit: OrbitControls;
  onChange?: (obj: THREE.Object3D) => void;
  onCommit?: (obj: THREE.Object3D, before: TransformSnapshot) => void;
}

export interface TransformSnapshot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export function snapshot(obj: THREE.Object3D): TransformSnapshot {
  return {
    position: obj.position.clone(),
    quaternion: obj.quaternion.clone(),
    scale: obj.scale.clone(),
  };
}

const SNAP_TRANSLATE = 0.25;
const SNAP_ROTATE = Math.PI / 12; // 15°
const SNAP_SCALE = 0.1;

export class TransformManager {
  readonly controls: TransformControls;
  private attached: THREE.Object3D | null = null;
  private beforeSnapshot: TransformSnapshot | null = null;
  private snapEnabled = false;
  private opts: TransformOptions;

  constructor(opts: TransformOptions) {
    this.opts = opts;
    this.controls = new TransformControls(opts.camera, opts.domElement);
    this.controls.setSize(0.85);
    // In recent three.js, TransformControls is not an Object3D itself; the
    // visible helper is obtained via getHelper().
    opts.scene.add(this.controls.getHelper());

    this.controls.addEventListener("dragging-changed", (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      opts.orbit.enabled = !dragging;
      if (dragging && this.attached) {
        this.beforeSnapshot = snapshot(this.attached);
      } else if (!dragging && this.attached && this.beforeSnapshot) {
        this.opts.onCommit?.(this.attached, this.beforeSnapshot);
        this.beforeSnapshot = null;
      }
    });

    this.controls.addEventListener("change", () => {
      if (this.attached) this.opts.onChange?.(this.attached);
    });
  }

  attach(obj: THREE.Object3D | null) {
    if (obj === this.attached) return;
    if (obj) {
      this.controls.attach(obj);
      this.attached = obj;
    } else {
      this.controls.detach();
      this.attached = null;
    }
  }

  setMode(mode: TransformMode) {
    this.controls.setMode(mode);
  }

  get mode(): TransformMode {
    return this.controls.getMode() as TransformMode;
  }

  setSnap(enabled: boolean) {
    this.snapEnabled = enabled;
    this.applySnap();
  }

  toggleSnap(): boolean {
    this.snapEnabled = !this.snapEnabled;
    this.applySnap();
    return this.snapEnabled;
  }

  get snap(): boolean {
    return this.snapEnabled;
  }

  private applySnap() {
    if (this.snapEnabled) {
      this.controls.setTranslationSnap(SNAP_TRANSLATE);
      this.controls.setRotationSnap(SNAP_ROTATE);
      this.controls.setScaleSnap(SNAP_SCALE);
    } else {
      this.controls.setTranslationSnap(null);
      this.controls.setRotationSnap(null);
      this.controls.setScaleSnap(null);
    }
  }

  dispose() {
    this.controls.detach();
    this.controls.dispose();
  }
}
