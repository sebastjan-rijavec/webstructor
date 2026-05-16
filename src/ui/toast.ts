/**
 * Lightweight transient notification ("toast"). One floating container
 * lives at the bottom-right of the viewport; new toasts replace the
 * current one rather than stacking — for the only current caller
 * (autosave) the cadence is slow enough that replacement is correct.
 */

const DEFAULT_DURATION_MS = 3000;

let containerEl: HTMLDivElement | null = null;
let activeTimeout: number | null = null;

function ensureContainer(): HTMLDivElement {
  if (containerEl && containerEl.isConnected) return containerEl;
  const el = document.createElement("div");
  el.id = "toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  document.body.appendChild(el);
  containerEl = el;
  return el;
}

export function showToast(
  message: string,
  durationMs: number = DEFAULT_DURATION_MS,
): void {
  const el = ensureContainer();
  el.textContent = message;
  // Re-trigger the visible state — also resets the fade-out animation if
  // a toast was already on screen.
  el.classList.remove("toast-visible");
  // Force reflow so the class toggle restarts the transition.
  void el.offsetWidth;
  el.classList.add("toast-visible");

  if (activeTimeout !== null) window.clearTimeout(activeTimeout);
  activeTimeout = window.setTimeout(() => {
    el.classList.remove("toast-visible");
    activeTimeout = null;
  }, durationMs);
}
