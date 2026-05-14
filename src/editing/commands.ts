import * as THREE from "three";
import type { Command } from "./history";
import type { Selection } from "./selection";
import type { TransformSnapshot } from "./transform";

export function addCommand(
  root: THREE.Object3D,
  obj: THREE.Object3D,
  selection: Selection,
): Command {
  return {
    label: `Add ${obj.name || "object"}`,
    do() {
      root.add(obj);
      selection.set([obj]);
    },
    undo() {
      selection.remove(obj);
      root.remove(obj);
    },
  };
}

export function deleteCommand(
  root: THREE.Object3D,
  objs: THREE.Object3D[],
  selection: Selection,
): Command {
  const previousSelection = selection.list;
  return {
    label: `Delete ${objs.length} object(s)`,
    do() {
      for (const obj of objs) {
        selection.remove(obj);
        root.remove(obj);
      }
    },
    undo() {
      for (const obj of objs) root.add(obj);
      selection.set(previousSelection);
    },
  };
}

export function duplicateCommand(
  root: THREE.Object3D,
  sources: THREE.Object3D[],
  selection: Selection,
): Command {
  const clones = sources.map((src) => {
    const clone = src.clone(true);
    // Clone shares geometries/materials, which is fine for now.
    // Offset a bit so the copy is visible.
    clone.position.add(new THREE.Vector3(0.5, 0, 0.5));
    return clone;
  });
  return {
    label: `Duplicate ${sources.length} object(s)`,
    do() {
      for (const c of clones) root.add(c);
      selection.set(clones);
    },
    undo() {
      for (const c of clones) {
        selection.remove(c);
        root.remove(c);
      }
    },
  };
}

export function groupCommand(
  root: THREE.Object3D,
  members: THREE.Object3D[],
  selection: Selection,
): Command {
  const group = new THREE.Group();
  group.name = "Group";
  // Capture original parents and world transforms to restore on undo.
  const originals = members.map((m) => ({
    obj: m,
    parent: m.parent,
  }));
  // Compute group origin as centroid of member world positions.
  const centroid = new THREE.Vector3();
  for (const m of members) {
    centroid.add(m.getWorldPosition(new THREE.Vector3()));
  }
  centroid.divideScalar(members.length);

  return {
    label: `Group ${members.length} objects`,
    do() {
      group.position.copy(centroid);
      root.add(group);
      for (const m of members) {
        // Keep world transform when reparenting.
        const worldPos = m.getWorldPosition(new THREE.Vector3());
        const worldQuat = m.getWorldQuaternion(new THREE.Quaternion());
        const worldScale = m.getWorldScale(new THREE.Vector3());
        group.add(m);
        group.worldToLocal(worldPos);
        m.position.copy(worldPos);
        // Compose local quaternion: invert group's world quat
        const inv = group
          .getWorldQuaternion(new THREE.Quaternion())
          .invert();
        m.quaternion.copy(inv.multiply(worldQuat));
        // Scale: divide by group's world scale (assumes uniform-ish scale)
        const groupScale = group.getWorldScale(new THREE.Vector3());
        m.scale.set(
          worldScale.x / groupScale.x,
          worldScale.y / groupScale.y,
          worldScale.z / groupScale.z,
        );
      }
      selection.set([group]);
    },
    undo() {
      // Move members back to their original parents preserving world transform.
      for (const { obj, parent } of originals) {
        const worldPos = obj.getWorldPosition(new THREE.Vector3());
        const worldQuat = obj.getWorldQuaternion(new THREE.Quaternion());
        const worldScale = obj.getWorldScale(new THREE.Vector3());
        const target = parent ?? root;
        target.add(obj);
        target.worldToLocal(worldPos);
        obj.position.copy(worldPos);
        const inv = target
          .getWorldQuaternion(new THREE.Quaternion())
          .invert();
        obj.quaternion.copy(inv.multiply(worldQuat));
        const parentScale = target.getWorldScale(new THREE.Vector3());
        obj.scale.set(
          worldScale.x / parentScale.x,
          worldScale.y / parentScale.y,
          worldScale.z / parentScale.z,
        );
      }
      selection.remove(group);
      root.remove(group);
      selection.set(members);
    },
  };
}

export function transformCommand(
  obj: THREE.Object3D,
  before: TransformSnapshot,
  after: TransformSnapshot,
): Command {
  return {
    label: `Transform ${obj.name || "object"}`,
    do() {
      obj.position.copy(after.position);
      obj.quaternion.copy(after.quaternion);
      obj.scale.copy(after.scale);
    },
    undo() {
      obj.position.copy(before.position);
      obj.quaternion.copy(before.quaternion);
      obj.scale.copy(before.scale);
    },
  };
}
