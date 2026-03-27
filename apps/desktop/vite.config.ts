import { defineConfig, type PluginOption } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

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
      plugins: mode === "analyze"
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
