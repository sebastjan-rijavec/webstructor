import * as THREE from "three";

/**
 * Raycast against the contents of `root` and return the top-level child of
 * `root` that contains the hit object. This is so clicking a child of a
 * grouped element selects the group, not the inner mesh.
 */
export function pickTopLevel(
  camera: THREE.Camera,
  root: THREE.Object3D,
  ndc: THREE.Vector2,
): THREE.Object3D | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(root.children, true);
  if (hits.length === 0) return null;
  for (const hit of hits) {
    let obj: THREE.Object3D | null = hit.object;
    while (obj && obj.parent && obj.parent !== root) {
      obj = obj.parent;
    }
    if (obj && obj.parent === root) return obj;
  }
  return null;
}

export function screenToNdc(
  event: { clientX: number; clientY: number },
  rect: DOMRect,
): THREE.Vector2 {
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}
