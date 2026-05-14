import * as THREE from "three";

export type ElementCategory = "primitive" | "widget" | "asset";

export interface ElementDefinition {
  id: string;
  label: string;
  category: ElementCategory;
  /** Single-character or short label shown above the name in the sidebar. */
  glyph?: string;
  /** Build a fresh, self-contained Object3D ready to drop into the scene. */
  create: () => THREE.Object3D;
}

const registry = new Map<string, ElementDefinition>();

export function registerElement(def: ElementDefinition) {
  if (registry.has(def.id)) {
    throw new Error(`Element id already registered: ${def.id}`);
  }
  registry.set(def.id, def);
}

export function getElement(id: string): ElementDefinition | undefined {
  return registry.get(id);
}

export function listElements(): ElementDefinition[] {
  return Array.from(registry.values());
}

/**
 * Instantiate an element by id. The returned object is tagged with the
 * definition id in userData so we can round-trip / reference it later.
 */
export function instantiate(id: string): THREE.Object3D {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown element: ${id}`);
  const obj = def.create();
  obj.userData.elementId = def.id;
  if (!obj.name) obj.name = def.label;
  return obj;
}
