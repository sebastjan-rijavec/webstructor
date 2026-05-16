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

const DEFAULT_AUTOSAVE_META: Pick<SceneSnapshotMeta, "name" | "sessionName"> = {
  name: "",
  sessionName: "Autosave",
};

export interface StartAutosaveOpts {
  intervalMs?: number;
  /** Lets the host pass the latest meta — e.g. mirror the last manual
   *  save's name/sessionName so the autosave and any UI message it
   *  triggers reference the user's session, not just "Autosave". */
  getMeta?: () => Pick<SceneSnapshotMeta, "name" | "sessionName">;
  /** Fires once per successful localStorage write. Skipped for empty
   *  scenes and for failed writes. Useful for showing a toast. */
  onSaved?: (snapshot: SceneSnapshot) => void;
}

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

function writeAutosave(
  root: THREE.Object3D,
  opts: StartAutosaveOpts,
): SceneSnapshot | null {
  const meta: SceneSnapshotMeta = {
    ...DEFAULT_AUTOSAVE_META,
    ...(opts.getMeta?.() ?? {}),
    savedAt: new Date().toISOString(),
  };
  const snapshot = captureScene(root, meta);
  // Skip writing when the scene is empty — there's nothing to recover, and
  // overwriting a previous autosave with an empty one would discard work
  // the user just cleared by accident.
  if (snapshot.scene.length === 0) return null;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch (err) {
    // Most likely QuotaExceededError. Don't break the editor over it.
    console.warn("[autosave] write failed:", err);
    return null;
  }
}

/**
 * Start the autosave interval. Returns a stop function.
 * The interval runs in addition to any manual save/restore the user does.
 */
export function startAutosave(
  root: THREE.Object3D,
  opts: StartAutosaveOpts = {},
): () => void {
  const intervalMs = opts.intervalMs ?? AUTOSAVE_INTERVAL_MS;
  const handle = window.setInterval(() => {
    const snapshot = writeAutosave(root, opts);
    if (snapshot && opts.onSaved) opts.onSaved(snapshot);
  }, intervalMs);
  return () => window.clearInterval(handle);
}
