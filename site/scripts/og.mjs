// Regenerates public/og.png (1200x630 social preview) from the built hero.
// Manual: `pnpm site:build && pnpm --filter @tracepilot/site og`, then rebuild and commit the PNG.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startPreview } from "./preview.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4188;
const url = `http://localhost:${PORT}/`;
const preview = await startPreview(root, PORT);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // let the trace field converge and the eye blink before capturing
  await page.waitForTimeout(4500);
  // no nav, and no version number that would go stale after the next release
  await page.addStyleTag({ content: ".nav, .hero-eyebrow { visibility: hidden !important; }" });
  await page.screenshot({ path: join(root, "public/og.png") });
  console.log("wrote site/public/og.png");
} finally {
  await browser?.close();
  preview.kill();
}
