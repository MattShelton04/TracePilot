import { defineConfig, devices } from "@playwright/experimental-ct-vue";
import vue from "@vitejs/plugin-vue";
import * as path from "node:path";

/**
 * Playwright Component Test config for @tracepilot/ui visual regression harness.
 *
 * Runs on-demand via `pnpm --filter @tracepilot/ui vrt` / `vrt:update`.
 * NOT wired into default test pipelines or CI — baselines are platform-sensitive
 * (font rendering differs between Windows and Linux) and must be refreshed
 * together on a single OS. See src/__vrt__/README.md for details.
 */
export default defineConfig({
  testDir: "./src/__vrt__",
  testMatch: "**/*.vrt.spec.ts",
  snapshotDir: "./src/__vrt__/__screenshots__",
  snapshotPathTemplate: "{snapshotDir}/{testFilePath}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  updateSnapshots: process.env.UPDATE_SNAPSHOTS === "1" ? "all" : "missing",
  use: {
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
    colorScheme: "dark",
    reducedMotion: "reduce",
    ctPort: 3100,
    ctViteConfig: {
      plugins: [vue()],
      resolve: {
        alias: {
          "@tracepilot/types": path.resolve(__dirname, "../types/src/index.ts"),
        },
      },
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
