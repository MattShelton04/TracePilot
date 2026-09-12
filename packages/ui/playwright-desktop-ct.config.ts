import * as path from "node:path";
import { defineConfig } from "@playwright/experimental-ct-vue";
import sharedConfig from "./playwright-ct.config";

// Reuse the installed CT runtime/template for desktop component geometry checks.
export default defineConfig(sharedConfig, {
  testDir: "./desktop-tests",
  testMatch: "**/*.ct.ts",
  use: {
    ctViteConfig: {
      ...sharedConfig.use?.ctViteConfig,
      resolve: {
        ...sharedConfig.use?.ctViteConfig?.resolve,
        alias: {
          ...sharedConfig.use?.ctViteConfig?.resolve?.alias,
          "@": path.resolve(__dirname, "../../apps/desktop/src"),
        },
      },
    },
  },
});
