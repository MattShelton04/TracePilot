import { createReadStream, existsSync } from "node:fs";
import { basename, join } from "node:path";
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

/** Dev only: the pages link the repo-level brand SVGs as ../assets/, which the build resolves on
    disk but the dev server can only see as the URL /assets/ inside its root; serve them there. */
function brandAssets() {
  const dir = here("../assets/");
  return {
    name: "tracepilot-brand-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/assets/", (req, res, next) => {
        const file = join(dir, basename(req.url.split("?")[0]));
        if (!file.endsWith(".svg") || !existsSync(file)) return next();
        res.setHeader("Content-Type", "image/svg+xml");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  // relative asset URLs: works under /TracePilot/ today and on a custom domain later
  base: "./",
  plugins: [siteFacts(), preloadFonts(), brandAssets()],
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
