/**
 * Minimal type shim for the `n8ao` package — it ships without TypeScript
 * declarations. Only the surface we actually use is typed here; expand if
 * the postprocessing pipeline ever needs more knobs.
 */
declare module "n8ao" {
  import type { Scene, Camera } from "three";
  import type { Pass } from "three/examples/jsm/postprocessing/Pass.js";

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: { r: number; g: number; b: number };
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    autoRenderBeauty: boolean;
    transparencyAware: boolean;
  }

  export type N8AOQualityMode =
    | "Performance"
    | "Low"
    | "Medium"
    | "High"
    | "Ultra";

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width: number, height: number);
    configuration: N8AOConfiguration;
    setQualityMode(mode: N8AOQualityMode): void;
    setSize(width: number, height: number): void;
    dispose(): void;
  }
}
