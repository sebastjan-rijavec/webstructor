import type { ElementDefinition } from "../library";

export interface SidebarOptions {
  container: HTMLElement;
  elements: ElementDefinition[];
  onPick: (def: ElementDefinition) => void;
}

export function renderSidebar(opts: SidebarOptions) {
  const { container, elements, onPick } = opts;
  container.innerHTML = "";
  for (const def of elements) {
    const item = document.createElement("button");
    item.className = "library-item";
    item.type = "button";
    item.title = def.label;
    item.dataset.elementId = def.id;
    item.innerHTML = `<span class="glyph">${def.glyph ?? "■"}</span>${def.label}`;
    item.addEventListener("click", () => onPick(def));
    container.appendChild(item);
  }
}
