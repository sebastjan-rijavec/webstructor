import * as THREE from "three";

type Listener = (selected: THREE.Object3D[]) => void;

const OUTLINE_COLOR = 0x4f9cf9;

export class Selection {
  private items = new Set<THREE.Object3D>();
  private listeners = new Set<Listener>();
  private helpers = new Map<THREE.Object3D, THREE.BoxHelper>();
  private helpersParent: THREE.Object3D;

  constructor(helpersParent: THREE.Object3D) {
    this.helpersParent = helpersParent;
  }

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
    for (const obj of this.items) this.removeHelper(obj);
    this.items.clear();
    for (const obj of objs) {
      this.items.add(obj);
      this.addHelper(obj);
    }
    this.notify();
  }

  add(obj: THREE.Object3D) {
    if (this.items.has(obj)) return;
    this.items.add(obj);
    this.addHelper(obj);
    this.notify();
  }

  remove(obj: THREE.Object3D) {
    if (!this.items.has(obj)) return;
    this.items.delete(obj);
    this.removeHelper(obj);
    this.notify();
  }

  toggle(obj: THREE.Object3D) {
    if (this.items.has(obj)) this.remove(obj);
    else this.add(obj);
  }

  clear() {
    if (this.items.size === 0) return;
    for (const obj of this.items) this.removeHelper(obj);
    this.items.clear();
    this.notify();
  }

  /**
   * Refresh all outline helpers so they track the current world bounds of
   * their target objects. Call this once per frame from the render loop.
   */
  updateHelpers() {
    for (const helper of this.helpers.values()) helper.update();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    const snapshot = this.list;
    for (const fn of this.listeners) fn(snapshot);
  }

  private addHelper(obj: THREE.Object3D) {
    const helper = new THREE.BoxHelper(obj, OUTLINE_COLOR);
    // BoxHelper sets its own world transform from the target; flag it so it
    // is not picked or transformed like content.
    helper.userData.__selectionHelper = true;
    this.helpers.set(obj, helper);
    this.helpersParent.add(helper);
  }

  private removeHelper(obj: THREE.Object3D) {
    const helper = this.helpers.get(obj);
    if (!helper) return;
    this.helpersParent.remove(helper);
    helper.dispose();
    this.helpers.delete(obj);
  }
}
