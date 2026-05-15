import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { registerElement } from "./registry";
import ponyUrl from "../../data/pony_cartoon.glb?url";
import starDestroyerUrl from "../../data/star_wars_imperial_ii_star_destroyer.glb?url";

// Library X — 25 random picks from data/Library_X/. Hardcoded so Vite only
// bundles these specific files (the source folder is 840MB / 234 GLBs and
// shouldn't be wholesale-included in dist). To re-roll, replace the import
// list and the DETAILS table below.
import detail00 from "../../data/Library_X/Detail_00.glb?url";
import detail01 from "../../data/Library_X/Detail_01.glb?url";
import detail08 from "../../data/Library_X/Detail_08.glb?url";
import detail10 from "../../data/Library_X/Detail_10.glb?url";
import detail19 from "../../data/Library_X/Detail_19.glb?url";
import detail21 from "../../data/Library_X/Detail_21.glb?url";
import detail27 from "../../data/Library_X/Detail_27.glb?url";
import detail100 from "../../data/Library_X/Detail_100.glb?url";
import detail101 from "../../data/Library_X/Detail_101.glb?url";
import detail104 from "../../data/Library_X/Detail_104.glb?url";
import detail125 from "../../data/Library_X/Detail_125.glb?url";
import detail134 from "../../data/Library_X/Detail_134.glb?url";
import detail135 from "../../data/Library_X/Detail_135.glb?url";
import detail149 from "../../data/Library_X/Detail_149.glb?url";
import detail152 from "../../data/Library_X/Detail_152.glb?url";
import detail158 from "../../data/Library_X/Detail_158.glb?url";
import detail182 from "../../data/Library_X/Detail_182.glb?url";
import detail187 from "../../data/Library_X/Detail_187.glb?url";
import detail194 from "../../data/Library_X/Detail_194.glb?url";
import detail207 from "../../data/Library_X/Detail_207.glb?url";
import detail208 from "../../data/Library_X/Detail_208.glb?url";
import detail235 from "../../data/Library_X/Detail_235.glb?url";
import detail270 from "../../data/Library_X/Detail_270.glb?url";
import detail273 from "../../data/Library_X/Detail_273.glb?url";
import detail299 from "../../data/Library_X/Detail_299.glb?url";

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

const DETAILS: Array<{ num: string; url: string }> = [
  { num: "00", url: detail00 },
  { num: "01", url: detail01 },
  { num: "08", url: detail08 },
  { num: "10", url: detail10 },
  { num: "19", url: detail19 },
  { num: "21", url: detail21 },
  { num: "27", url: detail27 },
  { num: "100", url: detail100 },
  { num: "101", url: detail101 },
  { num: "104", url: detail104 },
  { num: "125", url: detail125 },
  { num: "134", url: detail134 },
  { num: "135", url: detail135 },
  { num: "149", url: detail149 },
  { num: "152", url: detail152 },
  { num: "158", url: detail158 },
  { num: "182", url: detail182 },
  { num: "187", url: detail187 },
  { num: "194", url: detail194 },
  { num: "207", url: detail207 },
  { num: "208", url: detail208 },
  { num: "235", url: detail235 },
  { num: "270", url: detail270 },
  { num: "273", url: detail273 },
  { num: "299", url: detail299 },
];

for (const { num, url } of DETAILS) {
  const label = `Detail ${num}`;
  registerElement({
    id: `asset.detail_${num}`,
    label,
    category: "asset",
    glyph: "⬢",
    create: () => instantiateModel(url, label),
  });
}
