import * as THREE from "three";
import { registerElement } from "./registry";

function defaultMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xb8bcc4,
    metalness: 0.15,
    roughness: 0.55,
  });
}

function mesh(geom: THREE.BufferGeometry, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geom, defaultMaterial());
  m.name = name;
  return m;
}

registerElement({
  id: "prim.box",
  label: "Box",
  category: "primitive",
  glyph: "▣",
  create: () => mesh(new THREE.BoxGeometry(1, 1, 1), "Box"),
});

registerElement({
  id: "prim.sphere",
  label: "Sphere",
  category: "primitive",
  glyph: "●",
  create: () => mesh(new THREE.SphereGeometry(0.5, 32, 16), "Sphere"),
});

registerElement({
  id: "prim.cylinder",
  label: "Cylinder",
  category: "primitive",
  glyph: "▬",
  create: () => mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 32), "Cylinder"),
});

registerElement({
  id: "prim.cone",
  label: "Cone",
  category: "primitive",
  glyph: "▲",
  create: () => mesh(new THREE.ConeGeometry(0.5, 1, 32), "Cone"),
});

registerElement({
  id: "prim.torus",
  label: "Torus",
  category: "primitive",
  glyph: "◯",
  create: () => mesh(new THREE.TorusGeometry(0.5, 0.18, 16, 48), "Torus"),
});

registerElement({
  id: "prim.plane",
  label: "Plane",
  category: "primitive",
  glyph: "▭",
  create: () => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: 0xb8bcc4,
        metalness: 0.05,
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    m.name = "Plane";
    return m;
  },
});

registerElement({
  id: "prim.capsule",
  label: "Capsule",
  category: "primitive",
  glyph: "◍",
  create: () => mesh(new THREE.CapsuleGeometry(0.4, 0.6, 8, 16), "Capsule"),
});

registerElement({
  id: "prim.tetra",
  label: "Tetra",
  category: "primitive",
  glyph: "△",
  create: () => mesh(new THREE.TetrahedronGeometry(0.6), "Tetrahedron"),
});
