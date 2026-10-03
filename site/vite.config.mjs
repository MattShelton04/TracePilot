import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cspFor, fillPlaceholders, htmlFacts } from "./scripts/html-facts.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** Fills __placeholders__ (version, download link, showcase figures) and adds the CSP to each page. */
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
        return {
          html: fillPlaceholders(html, facts, ctx.filename),
          tags: [
            {
              tag: "meta",
              attrs: { "http-equiv": "Content-Security-Policy", content: cspFor(mode) },
              injectTo: "head-prepend",
            },
          ],
        };
      },
    },
  };
}

export default defineConfig({
  // relative asset URLs: works under /TracePilot/ today and on a custom domain later
  base: "./",
  plugins: [siteFacts()],
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
