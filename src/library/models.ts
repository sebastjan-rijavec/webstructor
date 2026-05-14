import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { registerElement } from "./registry";
import ponyUrl from "../../data/pony_cartoon.glb?url";
import starDestroyerUrl from "../../data/star_wars_imperial_ii_star_destroyer.glb?url";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

function loadModel(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((gltf) => gltf.scene);
    cache.set(url, p);
  }
  return p;
}

async function instantiateModel(
  url: string,
  name: string,
  scale = 1,
): Promise<THREE.Group> {
  const source = await loadModel(url);
  const clone = source.clone(true);
  // Deep clone geometry/material so per-instance edits don't bleed across.
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material.clone();
  });
  const wrapper = new THREE.Group();
  wrapper.name = name;
  wrapper.scale.setScalar(scale);
  wrapper.add(clone);
  return wrapper;
}

// Preload — fire and forget. First click on a button after this finishes is
// instant; clicks before completion will simply await the same promise.
loadModel(ponyUrl);
loadModel(starDestroyerUrl);

registerElement({
  id: "asset.pony",
  label: "Pony",
  category: "asset",
  create: () => instantiateModel(ponyUrl, "Pony"),
});

registerElement({
  id: "asset.star_destroyer",
  label: "Star Destroyer",
  category: "asset",
  create: () => instantiateModel(starDestroyerUrl, "Star Destroyer", 0.01),
});
