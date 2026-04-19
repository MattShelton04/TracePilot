/**
 * Eager markdown-it + DOMPurify loader.
 *
 * Call `ensureMarkdownReady()` at app startup so the parser is warmed up
 * before any MarkdownContent component renders — eliminates the layout
 * shift from raw-text fallback → parsed HTML.
 *
 * The loader is a singleton: multiple calls are safe and share one promise.
 */
import { ref } from "vue";

export type MarkdownRenderer = {
  render: (content: string) => string;
};

let mdInstance: MarkdownRenderer | null = null;
let purifyFn: ((dirty: string) => string) | null = null;

/** Reactive flag — true once both libs are initialized. */
export const mdReady = ref(false);

let loadPromise: Promise<void> | null = null;

export function ensureMarkdownReady(): Promise<void> {
  if (mdReady.value) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [{ default: MarkdownIt }, { default: DOMPurify }] = await Promise.all([
      import("markdown-it"),
      import("dompurify"),
    ]);
    mdInstance = new MarkdownIt({
      html: false,
      linkify: false,
      typographer: true,
      breaks: true,
    });
    purifyFn = (dirty: string) =>
      DOMPurify.sanitize(dirty, {
        // Reject data: URIs in src/href/action — inline SVG data URIs can
        // contain executable content in some WebView contexts.
        // Allows https, http, mailto, tel, relative refs, fragment anchors.
        ALLOWED_URI_REGEXP:
          /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        // Ensure the result is always a document fragment, not a full page.
        FORCE_BODY: true,
      });
    mdReady.value = true;
  })();
  return loadPromise;
}

/** Render markdown to sanitized HTML. Returns escaped text if not yet ready. */
export function renderMarkdown(content: string): string {
  if (!mdReady.value || !mdInstance || !purifyFn) {
    return escapeHtml(content);
  }
  const rawHtml = mdInstance.render(content.trim());
  return purifyFn(rawHtml);
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
