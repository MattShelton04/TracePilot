import { defineConfig } from "@playwright/experimental-ct-vue";
import sharedConfig from "./playwright-ct.config";

// Reuse the installed CT runtime/template for desktop component geometry checks.
export default defineConfig(sharedConfig, {
  testDir: "./desktop-tests",
  testMatch: "**/*.ct.ts",
});
