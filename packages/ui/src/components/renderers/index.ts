// Public renderer exports. Rich renderers register in `registry.ts` instead
// of being exported one by one.

export { default as CodeBlock } from "./CodeBlock.vue";
export { default as PlainTextRenderer } from "./PlainTextRenderer.vue";
export {
  getRegisteredRenderers,
  getRendererEntry,
  hasArgsRenderer,
  hasResultRenderer,
  type RendererEntry,
} from "./registry";
export { default as ToolArgsRenderer } from "./ToolArgsRenderer.vue";
export { default as ToolErrorDisplay } from "./ToolErrorDisplay.vue";
export { default as ToolResultRenderer } from "./ToolResultRenderer.vue";
