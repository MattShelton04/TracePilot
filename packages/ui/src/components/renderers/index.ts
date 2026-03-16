// Renderer barrel export — public API for the renderers subsystem.
export { default as ToolResultRenderer } from "./ToolResultRenderer.vue";
export { default as ToolArgsRenderer } from "./ToolArgsRenderer.vue";
export { default as RendererShell } from "./RendererShell.vue";
export { default as PlainTextRenderer } from "./PlainTextRenderer.vue";
export { default as CodeBlock } from "./CodeBlock.vue";

// Registry
export {
  getRendererEntry,
  getRegisteredRenderers,
  hasResultRenderer,
  hasArgsRenderer,
  type RendererEntry,
} from "./registry";
