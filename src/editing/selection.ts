import * as THREE from "three";

type Listener = (selected: THREE.Object3D[]) => void;

export class Selection {
  private items = new Set<THREE.Object3D>();
  private listeners = new Set<Listener>();
  private outlineColor = new THREE.Color(0x4f9cf9);
  private originalEmissive = new WeakMap<THREE.Mesh, THREE.Color>();

  get list(): THREE.Object3D[] {
    return Array.from(this.items);
  }

  get primary(): THREE.Object3D | null {
    return this.items.size > 0 ? this.list[this.list.length - 1] : null;
  }

  has(obj: THREE.Object3D): boolean {
    return this.items.has(obj);
  }

  set(objs: THREE.Object3D[]) {
    for (const obj of this.items) this.removeHighlight(obj);
    this.items.clear();
    for (const obj of objs) {
      this.items.add(obj);
      this.applyHighlight(obj);
    }
    this.notify();
  }

  add(obj: THREE.Object3D) {
    if (this.items.has(obj)) return;
    this.items.add(obj);
    this.applyHighlight(obj);
    this.notify();
  }

  remove(obj: THREE.Object3D) {
    if (!this.items.has(obj)) return;
    this.items.delete(obj);
    this.removeHighlight(obj);
    this.notify();
  }

  toggle(obj: THREE.Object3D) {
    if (this.items.has(obj)) this.remove(obj);
    else this.add(obj);
  }

  clear() {
    if (this.items.size === 0) return;
    for (const obj of this.items) this.removeHighlight(obj);
    this.items.clear();
    this.notify();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    const snapshot = this.list;
    for (const fn of this.listeners) fn(snapshot);
  }

  private applyHighlight(obj: THREE.Object3D) {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && "emissive" in mat) {
          if (!this.originalEmissive.has(mesh)) {
            this.originalEmissive.set(mesh, mat.emissive.clone());
          }
          mat.emissive.copy(this.outlineColor).multiplyScalar(0.35);
        }
      }
    });
  }

  private removeHighlight(obj: THREE.Object3D) {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const orig = this.originalEmissive.get(mesh);
        if (mat && "emissive" in mat && orig) {
          mat.emissive.copy(orig);
        }
      }
    });
  }
}
