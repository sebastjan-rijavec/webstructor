import type { SceneSnapshot, SceneSnapshotMeta } from "../persistence/scene-io";
import { validateSnapshot } from "../persistence/scene-io";

/**
 * Save + Open modals for the session persistence feature (issue #24).
 * Each call mounts a fresh modal on `document.body` and dismisses itself
 * on Cancel, Escape, or backdrop click. The host wires callbacks for the
 * actual save (file download) and restore (apply snapshot) work.
 */

function buildModal(title: string): {
  root: HTMLDivElement;
  body: HTMLDivElement;
  close: () => void;
} {
  const root = document.createElement("div");
  root.className = "modal-backdrop";
  root.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true">
      <header class="modal-header">
        <h2>${title}</h2>
        <button class="modal-close" type="button" aria-label="Close">×</button>
      </header>
      <div class="modal-body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const body = root.querySelector<HTMLDivElement>(".modal-body")!;
  const closeBtn = root.querySelector<HTMLButtonElement>(".modal-close")!;

  function close(): void {
    document.removeEventListener("keydown", onKey);
    root.remove();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }

  closeBtn.addEventListener("click", close);
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  document.addEventListener("keydown", onKey);

  return { root, body, close };
}

// ---------------------------------------------------------------- Save dialog

interface SaveDialogOpts {
  initialName?: string;
  initialSessionName?: string;
  onSave: (meta: SceneSnapshotMeta) => void;
}

export function openSaveDialog(opts: SaveDialogOpts): void {
  const { close, body } = buildModal("Save session");
  body.innerHTML = `
    <form class="modal-form">
      <label class="modal-field">
        <span>Your name</span>
        <input type="text" name="name" required autocomplete="name"
               value="${escapeAttr(opts.initialName ?? "")}" />
      </label>
      <label class="modal-field">
        <span>Session name</span>
        <input type="text" name="sessionName" required
               value="${escapeAttr(opts.initialSessionName ?? "")}" />
      </label>
      <div class="modal-actions">
        <button type="button" class="modal-btn" data-action="cancel">Cancel</button>
        <button type="submit" class="modal-btn modal-btn-primary">Save</button>
      </div>
    </form>
  `;
  const form = body.querySelector<HTMLFormElement>(".modal-form")!;
  const nameInput = form.querySelector<HTMLInputElement>('[name="name"]')!;
  nameInput.focus();
  nameInput.select();

  form
    .querySelector<HTMLButtonElement>('[data-action="cancel"]')!
    .addEventListener("click", close);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const meta: SceneSnapshotMeta = {
      name: String(data.get("name") ?? "").trim(),
      sessionName: String(data.get("sessionName") ?? "").trim(),
      savedAt: new Date().toISOString(),
    };
    if (!meta.name || !meta.sessionName) return;
    close();
    opts.onSave(meta);
  });
}

// ---------------------------------------------------------------- Open dialog

interface OpenDialogOpts {
  autosave: SceneSnapshot | null;
  onRestore: (snapshot: SceneSnapshot) => Promise<void> | void;
  onDeleteAutosave: () => void;
}

export function openOpenDialog(opts: OpenDialogOpts): void {
  const { close, body } = buildModal("Open session");
  body.innerHTML = `
    <div class="modal-section">
      <p class="modal-section-label">Restore from file</p>
      <label class="modal-file">
        <input type="file" accept=".json,application/json" />
        <span>Choose a .webstructor.json file</span>
      </label>
    </div>
    <div class="modal-section" data-section="autosave"></div>
    <div class="modal-actions">
      <button type="button" class="modal-btn" data-action="cancel">Cancel</button>
    </div>
    <p class="modal-error" data-role="error"></p>
  `;

  const errorEl = body.querySelector<HTMLElement>('[data-role="error"]')!;
  const autosaveSection = body.querySelector<HTMLDivElement>(
    '[data-section="autosave"]',
  )!;

  if (opts.autosave) {
    const meta = opts.autosave.meta;
    autosaveSection.innerHTML = `
      <p class="modal-section-label">Autosave</p>
      <div class="modal-autosave-row">
        <div>
          <strong>${escapeHtml(meta.sessionName || "Autosave")}</strong>
          <span class="modal-autosave-date">${formatDate(meta.savedAt)}</span>
        </div>
        <div class="modal-autosave-actions">
          <button type="button" class="modal-btn" data-action="restore-autosave">Restore</button>
          <button type="button" class="modal-btn modal-btn-ghost" data-action="delete-autosave">Delete</button>
        </div>
      </div>
    `;
    autosaveSection
      .querySelector<HTMLButtonElement>('[data-action="restore-autosave"]')!
      .addEventListener("click", async () => {
        try {
          await opts.onRestore(opts.autosave!);
          close();
        } catch (err) {
          errorEl.textContent = (err as Error).message;
        }
      });
    autosaveSection
      .querySelector<HTMLButtonElement>('[data-action="delete-autosave"]')!
      .addEventListener("click", () => {
        opts.onDeleteAutosave();
        autosaveSection.innerHTML = "";
      });
  }

  body
    .querySelector<HTMLButtonElement>('[data-action="cancel"]')!
    .addEventListener("click", close);

  const fileInput = body.querySelector<HTMLInputElement>('input[type="file"]')!;
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const snapshot = validateSnapshot(JSON.parse(text));
      await opts.onRestore(snapshot);
      close();
    } catch (err) {
      errorEl.textContent = `Couldn't restore: ${(err as Error).message}`;
    }
  });
}

// ---------------------------------------------------------------- helpers

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
