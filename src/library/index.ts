// Side-effect imports register elements into the registry.
import "./primitives";

export {
  type ElementDefinition,
  type ElementCategory,
  registerElement,
  getElement,
  listElements,
  instantiate,
} from "./registry";
