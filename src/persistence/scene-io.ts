import * as THREE from "three";
import { instantiate, getElement } from "../library";

/**
 * Scene save/restore (issue #24).
 *
 * Only the user-content tree under `viewport.root` is serialized — helpers,
 * lights, camera, etc. are reconstructed from the runtime, not persisted.
 * Each node records the bare minimum needed to round-trip:
 *   - an `element` node references a library entry by `elementId` so the
 *     factory can re-instantiate the same primitive/GLB on load;
 *   - a `group` node holds a `name` + recursive `children` so the user's
 *     organisational structure is preserved across save/restore.
 *
 * No geometry or materials are serialised — that's exactly the point.
 * Saved files are small (a few KB even for dense scenes).
 */

export const SCENE_FORMAT = "webstructor.scene";
export const SCENE_FORMAT_VERSION = 1;

interface TRS {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

interface ElementNode {
  type: "element";
  elementId: string;
  name?: string;
  transform: TRS;
}

interface GroupNode {
  type: "group";
  name?: string;
  transform: TRS;
  children: SceneNode[];
}

type SceneNode = ElementNode | GroupNode;

export interface SceneSnapshotMeta {
  /** User-provided name (their name, not the file's). */
  name: string;
  /** User-provided name for what they're building. */
  sessionName: string;
  /** ISO 8601 UTC timestamp when this snapshot was created. */
  savedAt: string;
}

export interface SceneSnapshot {
  format: typeof SCENE_FORMAT;
  version: typeof SCENE_FORMAT_VERSION;
  meta: SceneSnapshotMeta;
  scene: SceneNode[];
}

function captureTransform(obj: THREE.Object3D): TRS {
  return {
    position: [obj.position.x, obj.position.y, obj.position.z],
    quaternion: [
      obj.quaternion.x,
      obj.quaternion.y,
      obj.quaternion.z,
      obj.quaternion.w,
    ],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z],
  };
}

function applyTransform(obj: THREE.Object3D, trs: TRS): void {
  obj.position.fromArray(trs.position);
  obj.quaternion.fromArray(trs.quaternion);
  obj.scale.fromArray(trs.scale);
}

function captureNode(obj: THREE.Object3D): SceneNode | null {
  const elementId = obj.userData.elementId as string | undefined;
  const transform = captureTransform(obj);
  if (elementId) {
    return {
      type: "element",
      elementId,
      name: obj.name || undefined,
      transform,
    };
  }
  // A Group with no elementId — typically a user-created group via Ctrl+G.
  const children: SceneNode[] = [];
  for (const child of obj.children) {
    const captured = captureNode(child);
    if (captured) children.push(captured);
  }
  return {
    type: "group",
    name: obj.name || undefined,
    transform,
    children,
  };
}

/**
 * Walk `root` and build a snapshot of every user-created subtree. The root
 * group itself isn't represented in the output — its children become the
 * top-level entries in `snapshot.scene`.
 */
export function captureScene(
  root: THREE.Object3D,
  meta: SceneSnapshotMeta,
): SceneSnapshot {
  const scene: SceneNode[] = [];
  for (const child of root.children) {
    const node = captureNode(child);
    if (node) scene.push(node);
  }
  return {
    format: SCENE_FORMAT,
    version: SCENE_FORMAT_VERSION,
    meta,
    scene,
  };
}

async function restoreNode(node: SceneNode): Promise<THREE.Object3D | null> {
  if (node.type === "element") {
    if (!getElement(node.elementId)) {
      console.warn(
        `[scene-io] Skipping element with unknown id "${node.elementId}". ` +
          "Library entry may have been removed or renamed.",
      );
      return null;
    }
    const obj = await instantiate(node.elementId);
    if (node.name) obj.name = node.name;
    applyTransform(obj, node.transform);
    return obj;
  }
  // Group
  const group = new THREE.Group();
  if (node.name) group.name = node.name;
  applyTransform(group, node.transform);
  for (const childNode of node.children) {
    const child = await restoreNode(childNode);
    if (child) group.add(child);
  }
  return group;
}

/**
 * Replace the entire contents of `root` with the snapshot's tree.
 * Returns the array of top-level objects added (callers may want to use
 * it to set the selection).
 */
export async function restoreScene(
  root: THREE.Object3D,
  snapshot: SceneSnapshot,
): Promise<THREE.Object3D[]> {
  // Remove existing user content (root.children, not the root itself).
  while (root.children.length > 0) {
    root.remove(root.children[0]);
  }
  const restored: THREE.Object3D[] = [];
  for (const node of snapshot.scene) {
    const obj = await restoreNode(node);
    if (obj) {
      root.add(obj);
      restored.push(obj);
    }
  }
  return restored;
}

/**
 * Validate that an arbitrary parsed JSON value is a SceneSnapshot of a
 * supported format/version. Throws on mismatch with a helpful message.
 */
export function validateSnapshot(value: unknown): SceneSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Snapshot is not an object");
  }
  const s = value as Partial<SceneSnapshot>;
  if (s.format !== SCENE_FORMAT) {
    throw new Error(
      `Unrecognised format: expected "${SCENE_FORMAT}", got "${s.format}"`,
    );
  }
  if (s.version !== SCENE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported version: expected ${SCENE_FORMAT_VERSION}, got ${s.version}`,
    );
  }
  if (!s.meta || typeof s.meta !== "object") {
    throw new Error("Snapshot missing meta");
  }
  if (!Array.isArray(s.scene)) {
    throw new Error("Snapshot missing scene array");
  }
  return s as SceneSnapshot;
}
