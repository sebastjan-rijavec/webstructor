// Side-effect imports register elements into the registry.
import "./primitives";
import "./models";

export {
  type ElementDefinition,
  type ElementCategory,
  registerElement,
  getElement,
  listElements,
  instantiate,
} from "./registry";
