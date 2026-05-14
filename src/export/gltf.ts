import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export interface ExportOptions {
  /** If true, embed as binary .glb. If false, emit JSON .gltf. */
  binary: boolean;
  /** Filename without extension. */
  filename?: string;
}

export async function exportScene(
  root: THREE.Object3D,
  opts: ExportOptions = { binary: true },
): Promise<void> {
  const exporter = new GLTFExporter();
  const filename = opts.filename ?? "kitbash";

  const result = await new Promise<ArrayBuffer | object>((resolve, reject) => {
    exporter.parse(
      root,
      (out) => resolve(out),
      (err) => reject(err),
      {
        binary: opts.binary,
        onlyVisible: true,
        embedImages: true,
      },
    );
  });

  if (opts.binary && result instanceof ArrayBuffer) {
    downloadBlob(new Blob([result], { type: "model/gltf-binary" }), `${filename}.glb`);
  } else {
    const json = JSON.stringify(result, null, 2);
    downloadBlob(new Blob([json], { type: "model/gltf+json" }), `${filename}.gltf`);
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
