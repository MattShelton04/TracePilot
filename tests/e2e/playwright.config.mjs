import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  outputDir: "../../.tracepilot/e2e-results/tests",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: ".tracepilot/e2e-results/report", open: "never" }],
    ["junit", { outputFile: ".tracepilot/e2e-results/results.xml" }],
  ],
});
