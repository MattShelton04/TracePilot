import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cspFor, fillPlaceholders, htmlFacts, inlineScriptHashes } from "./scripts/html-facts.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// fonts the first viewport paints with; preloading them starts the download with the HTML
// instead of after the stylesheet, and the boot script waits for them before the hero enters
const PRELOAD_FONTS = [/inter-latin-wght-normal/, /jetbrains-mono-latin-(400|500)-normal/];

/** Fills __placeholders__ (version, download link, showcase figures), adds the CSP to each page
    and, in builds, preloads the first-paint fonts. */
function siteFacts() {
  let mode = "build";
  return {
    name: "tracepilot-site-facts",
    configResolved(config) {
      mode = config.command;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const facts = htmlFacts(
          here("./src/data/showcase.json"),
          here("./src/data/release.json"),
          mode,
        );
        const filled = fillPlaceholders(html, facts, ctx.filename);
        return {
          html: filled,
          tags: [
            {
              tag: "meta",
              attrs: {
                "http-equiv": "Content-Security-Policy",
                content: cspFor(mode, inlineScriptHashes(filled)),
              },
              injectTo: "head-prepend",
            },
          ],
        };
      },
    },
  };
}

function preloadFonts() {
  return {
    name: "tracepilot-preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const up = "../".repeat(ctx.path.split("/").length - 2) || "./";
        return Object.keys(ctx.bundle ?? {})
          .filter((f) => f.endsWith(".woff2") && PRELOAD_FONTS.some((re) => re.test(f)))
          .map((f) => ({
            tag: "link",
            attrs: {
              rel: "preload",
              href: up + f,
              as: "font",
              type: "font/woff2",
              crossorigin: "",
            },
            injectTo: "head",
          }));
      },
    },
  };
}

export default defineConfig({
  // relative asset URLs: works under /TracePilot/ today and on a custom domain later
  base: "./",
  plugins: [siteFacts(), preloadFonts()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // fonts stay files: the CSP allows font-src 'self' only
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    rollupOptions: {
      input: { main: here("./index.html"), demo: here("./demo/index.html") },
    },
  },
  server: { port: 5180, strictPort: true },
  preview: { port: 4180, strictPort: true },
});
