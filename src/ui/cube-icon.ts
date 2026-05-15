import type { ViewName } from "../scene/viewport";

/**
 * SVG cube illustrations rendered above the camera widget — one per view.
 * All icons use `currentColor` for strokes so they inherit the rail's
 * theme (`var(--fg)`), and consume `var(--font-mono)` for labels. The
 * abbreviation scheme matches the design-guidelines image (issue #15):
 * F / BK / L / R / T / B for the six axis views, classic three-face
 * isometric for perspective.
 */

function faceIcon(label: string): string {
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">
      <rect x="9" y="9" width="30" height="30" rx="1"/>
    </g>
    <g style="font: 700 12px var(--font-mono); fill: currentColor; letter-spacing: 0.04em;">
      <text x="24" y="28" text-anchor="middle" dominant-baseline="middle">${label}</text>
    </g>
  </svg>`;
}

const PERSPECTIVE_CUBE = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">
    <path d="M8 16 L24 8 L40 16 L40 32 L24 40 L8 32 Z"/>
    <path d="M8 16 L24 24 L40 16"/>
    <path d="M24 24 L24 40"/>
  </g>
  <g style="font: 700 7px var(--font-mono); fill: currentColor;">
    <text x="16" y="33" text-anchor="middle">F</text>
    <text x="32" y="33" text-anchor="middle">R</text>
  </g>
</svg>`;

const ICONS: Record<ViewName, string> = {
  perspective: PERSPECTIVE_CUBE,
  front: faceIcon("F"),
  back: faceIcon("BK"),
  left: faceIcon("L"),
  right: faceIcon("R"),
  top: faceIcon("T"),
  bottom: faceIcon("B"),
};

export function cubeIconSvg(view: ViewName): string {
  return ICONS[view];
}
