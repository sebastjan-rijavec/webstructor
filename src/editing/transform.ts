import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type TransformMode = "translate" | "rotate" | "scale";

export interface TransformOptions {
  camera: THREE.Camera;
  domElement: HTMLElement;
  scene: THREE.Scene;
  orbit: OrbitControls;
  onCommit?: (records: TransformRecord[]) => void;
}

export interface TransformSnapshot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export interface TransformRecord {
  obj: THREE.Object3D;
  before: TransformSnapshot;
  after: TransformSnapshot;
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

type DragState =
  | { kind: "single"; obj: THREE.Object3D; before: TransformSnapshot }
  | {
      kind: "multi";
      pivotStartInv: THREE.Matrix4;
      members: {
        obj: THREE.Object3D;
        before: TransformSnapshot;
        startWorld: THREE.Matrix4;
      }[];
    };

export class TransformManager {
  readonly controls: TransformControls;
  private attached: THREE.Object3D[] = [];
  private pivot: THREE.Object3D;
  private dragState: DragState | null = null;
  private snapEnabled = false;
  private opts: TransformOptions;

  constructor(opts: TransformOptions) {
    this.opts = opts;
    this.controls = new TransformControls(opts.camera, opts.domElement);
    this.controls.setSize(0.85);
    opts.scene.add(this.controls.getHelper());

    // Invisible pivot used when >1 object is selected. Lives in the scene so
    // its world matrix is kept current by the render loop. Not exported (not
    // a child of viewport.root).
    this.pivot = new THREE.Object3D();
    this.pivot.name = "__multiPivot";
    opts.scene.add(this.pivot);

    this.controls.addEventListener("dragging-changed", (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      opts.orbit.enabled = !dragging;
      if (dragging) this.onDragStart();
      else this.onDragEnd();
    });

    this.controls.addEventListener("change", () => {
      if (this.dragState?.kind === "multi") this.applyMultiDelta();
    });
  }

  /**
   * Attach the gizmo to a list of objects.
   * - 0: detach.
   * - 1: attach directly to that object (gizmo uses its local axes).
   * - >1: attach to an internal pivot at the centroid; world-space delta is
   *   propagated to every selected object on drag.
   */
  setObjects(objs: THREE.Object3D[]) {
    this.attached = [...objs];
    if (objs.length === 0) {
      this.controls.detach();
      return;
    }
    if (objs.length === 1) {
      this.controls.attach(objs[0]);
      return;
    }
    this.repositionPivot();
    this.controls.attach(this.pivot);
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

  dispose() {
    this.controls.detach();
    this.controls.dispose();
    this.opts.scene.remove(this.pivot);
  }

  private repositionPivot() {
    const centroid = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    for (const o of this.attached) {
      o.updateMatrixWorld(true);
      o.getWorldPosition(tmp);
      centroid.add(tmp);
    }
    centroid.divideScalar(this.attached.length);
    this.pivot.position.copy(centroid);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
  }

  private onDragStart() {
    if (this.attached.length === 0) return;
    if (this.attached.length === 1) {
      this.dragState = {
        kind: "single",
        obj: this.attached[0],
        before: snapshot(this.attached[0]),
      };
      return;
    }
    this.pivot.updateMatrixWorld(true);
    const pivotStartInv = this.pivot.matrixWorld.clone().invert();
    const members = this.attached.map((obj) => {
      obj.updateMatrixWorld(true);
      return {
        obj,
        before: snapshot(obj),
        startWorld: obj.matrixWorld.clone(),
      };
    });
    this.dragState = { kind: "multi", pivotStartInv, members };
  }

  private applyMultiDelta() {
    if (this.dragState?.kind !== "multi") return;
    this.pivot.updateMatrixWorld(true);
    const delta = new THREE.Matrix4()
      .copy(this.pivot.matrixWorld)
      .multiply(this.dragState.pivotStartInv);
    const newWorld = new THREE.Matrix4();
    const parentInv = new THREE.Matrix4();
    const newLocal = new THREE.Matrix4();
    for (const m of this.dragState.members) {
      newWorld.multiplyMatrices(delta, m.startWorld);
      const parent = m.obj.parent;
      if (parent) {
        parent.updateMatrixWorld(true);
        parentInv.copy(parent.matrixWorld).invert();
        newLocal.multiplyMatrices(parentInv, newWorld);
      } else {
        newLocal.copy(newWorld);
      }
      newLocal.decompose(m.obj.position, m.obj.quaternion, m.obj.scale);
    }
  }

  private onDragEnd() {
    if (!this.dragState) return;
    let records: TransformRecord[];
    if (this.dragState.kind === "single") {
      records = [
        {
          obj: this.dragState.obj,
          before: this.dragState.before,
          after: snapshot(this.dragState.obj),
        },
      ];
    } else {
      records = this.dragState.members.map((m) => ({
        obj: m.obj,
        before: m.before,
        after: snapshot(m.obj),
      }));
    }
    const wasMulti = this.dragState.kind === "multi";
    this.dragState = null;
    this.opts.onCommit?.(records);
    // After a multi-drag, re-center the pivot at the new centroid with
    // identity rotation/scale so the next drag starts cleanly.
    if (wasMulti) this.repositionPivot();
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
}
