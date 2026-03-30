import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { defineConfig, type PluginOption } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-vue": ["vue", "vue-router", "pinia"],
          "vendor-tauri": [
            "@tauri-apps/api",
            "@tauri-apps/plugin-dialog",
            "@tauri-apps/plugin-log",
            "@tauri-apps/plugin-opener",
            "@tauri-apps/plugin-process",
            "@tauri-apps/plugin-updater",
          ],
        },
      },
      plugins:
        mode === "analyze"
          ? [
              // Dynamic import because rollup-plugin-visualizer is ESM-only
              import("rollup-plugin-visualizer").then((m) =>
                m.visualizer({
                  filename: "dist/bundle-stats.html",
                  open: true,
                  gzipSize: true,
                  template: "treemap",
                }),
              ) as unknown as PluginOption,
            ]
          : [],
    },
  },
}));
