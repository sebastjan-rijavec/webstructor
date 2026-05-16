import type { SceneSnapshot, SceneSnapshotMeta } from "./scene-io";
import { captureScene, validateSnapshot } from "./scene-io";
import type * as THREE from "three";

/**
 * Browser-local autosave (issue #24). Manual saves go to file download;
 * autosave lives in localStorage and exists only as a recovery slot.
 *
 * Every `intervalMs` we capture the current scene and overwrite the
 * single AUTOSAVE_KEY entry. On page load main.ts checks for it and can
 * offer to restore.
 */

const AUTOSAVE_KEY = "webstructor-autosave";
export const AUTOSAVE_INTERVAL_MS = 60_000;

const AUTOSAVE_META: SceneSnapshotMeta = {
  name: "",
  sessionName: "Autosave",
  savedAt: "", // overwritten per snapshot below
};

export function readAutosave(): SceneSnapshot | null {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return null;
  try {
    return validateSnapshot(JSON.parse(raw));
  } catch (err) {
    console.warn("[autosave] discarding invalid autosave:", err);
    localStorage.removeItem(AUTOSAVE_KEY);
    return null;
  }
}

export function clearAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
}

function writeAutosave(root: THREE.Object3D): void {
  const snapshot = captureScene(root, {
    ...AUTOSAVE_META,
    savedAt: new Date().toISOString(),
  });
  // Skip writing when the scene is empty — there's nothing to recover, and
  // overwriting a previous autosave with an empty one would discard work
  // the user just cleared by accident.
  if (snapshot.scene.length === 0) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // Most likely QuotaExceededError. Don't break the editor over it.
    console.warn("[autosave] write failed:", err);
  }
}

/**
 * Start the autosave interval. Returns a stop function.
 * The interval runs in addition to any manual save/restore the user does.
 */
export function startAutosave(
  root: THREE.Object3D,
  intervalMs: number = AUTOSAVE_INTERVAL_MS,
): () => void {
  const handle = window.setInterval(() => writeAutosave(root), intervalMs);
  return () => window.clearInterval(handle);
}
