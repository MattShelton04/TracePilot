// Browser regression for the generated report. Runs in unprivileged capture CI,
// never in the trusted publisher. --report can exercise an actual captured pair.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { encodeHeat } from "./png.mjs";
import { buildReport } from "./report.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split(/=(.*)/s)),
);
const temp = await mkdtemp(join(tmpdir(), "tracepilot-gallery-check-"));
const root = args.report ? resolve(args.report) : join(temp, "report");
let browser;
let server;
try {
  if (!args.report) {
    for (const side of ["base", "head"]) {
      const directory = join(temp, side);
      await mkdir(directory);
      const pixels = Buffer.alloc(1440 * 960 * 4, 255);
      if (side === "head") pixels[0] = 254;
      await writeFile(join(directory, "sessions.png"), encodeHeat(pixels));
      await writeFile(
        join(directory, "capture-1-1.json"),
        JSON.stringify({ schema: 1, cases: [{ id: "sessions", status: "captured" }] }),
      );
    }
    await buildReport({ baseDir: join(temp, "base"), headDir: join(temp, "head"), output: root });
  }
  const html = await readFile(join(root, "index.html"), "utf8");
  const report = JSON.parse(
    /<script id="report-data" type="application\/json">(.*?)<\/script>/.exec(html)[1],
  );
  const row =
    report.rows.find((row) => row.id === "session-conversation" && row.analyses?.[0].changed) ??
    report.rows.find((row) => row.analyses?.[0].changed);
  assert.ok(row, "Need a paired changed view for the interaction check");
  server = createServer(async (request, response) => {
    try {
      const file = resolve(
        root,
        `.${decodeURIComponent(new URL(request.url, "http://local").pathname)}`,
      );
      if (!file.startsWith(root + sep)) throw Error("path");
      const bytes = await readFile(file);
      response.setHeader("Content-Type", extname(file) === ".png" ? "image/png" : "text/html");
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch(args.channel ? { channel: args.channel } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    // Stronger than privacy noise: the report must work without readback at all.
    window.canvasReads = 0;
    const forbidden = () => {
      window.canvasReads++;
      throw Error("Canvas extraction unavailable");
    };
    CanvasRenderingContext2D.prototype.getImageData = forbidden;
    HTMLCanvasElement.prototype.toDataURL = forbidden;
    HTMLCanvasElement.prototype.toBlob = forbidden;
  });
  const url = `http://127.0.0.1:${server.address().port}/index.html#view=${row.id}&mode=difference`;
  await page.goto(url);
  const metric = page.locator("#pixel-metric");
  await page.waitForFunction(() =>
    document.querySelector("#pixel-metric").textContent.includes("precomputed from PNGs"),
  );
  assert.ok((await metric.innerText()).startsWith(row.analyses[0].changed.toLocaleString("en-US")));
  assert.equal(await page.locator(".bounds").count(), row.analyses[0].regions.length);
  const shot = async (name) => {
    if (!args.evidence) return;
    await mkdir(resolve(args.evidence), { recursive: true });
    await page.screenshot({ path: join(resolve(args.evidence), `${name}.png`) });
  };
  await shot("after-exact");
  for (const threshold of ["8", "16", "32", "0"]) {
    await page.locator("#threshold").selectOption(threshold);
    await page.waitForFunction(
      (expected) => document.querySelector("#pixel-metric").textContent.startsWith(expected),
      row.analyses[threshold].changed.toLocaleString("en-US"),
    );
    assert.ok((await metric.innerText()).includes("precomputed from PNGs"));
  }
  await page.locator("#regions button").first().click();
  assert.equal(await page.locator("#zoom-value").innerText(), "100%");
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  for (const mode of ["Side by side", "Before / after", "Wipe", "Overlay", "Difference"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: mode, exact: true }).getAttribute("aria-pressed"),
      "true",
    );
    if (mode === "Before / after") {
      await page.getByRole("button", { name: "Before", exact: true }).click();
      assert.equal(
        await page.locator("#image-stage img").first().getAttribute("alt"),
        `Before: ${row.id}`,
      );
      await page.getByRole("button", { name: "After", exact: true }).click();
    }
    if (mode === "Wipe") {
      const grip = page.getByRole("separator");
      await grip.press("Home");
      await grip.press("ArrowRight");
      assert.equal(await grip.getAttribute("aria-valuenow"), "1");
      await page.locator("#wipe-range").fill("50");
      const box = await grip.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + box.height / 2);
      await page.mouse.up();
      assert.ok(Number(await page.locator("#wipe-range").inputValue()) > 50);
    }
    if (mode === "Overlay") {
      await page.locator("#opacity").fill("40");
      assert.equal(
        await page.locator("#opacity-layer").evaluate((node) => node.style.opacity),
        "0.4",
      );
    }
  }
  for (const [width, height] of [
    [960, 640],
    [2560, 1440],
    [1440, 960],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth > innerWidth ||
          document.documentElement.scrollHeight > innerHeight,
      ),
      false,
    );
  }
  assert.equal(await page.evaluate(() => window.canvasReads), 0);
  assert.deepEqual(errors, []);
  await page.goto(`${pathToFileURL(join(root, "index.html")).href}#view=${row.id}&mode=difference`);
  await page.waitForFunction(() =>
    document.querySelector("#pixel-metric").textContent.includes("precomputed from PNGs"),
  );
  assert.equal(await page.locator(".bounds").count(), row.analyses[0].regions.length);
  assert.equal(await page.evaluate(() => window.canvasReads), 0);
  assert.deepEqual(errors, []);
  // A lost overlay is an explicit failure, never a successful empty comparison.
  await page.route("**/diff-*.png*", (route) => route.abort());
  await page.goto(url);
  await page.waitForFunction(() =>
    document.querySelector("#pixel-metric").textContent.includes("Pixel analysis unavailable"),
  );
  assert.equal(await page.locator(".bounds").count(), 0);
  console.log(
    JSON.stringify({
      view: row.id,
      pixels: row.analyses[0].changed,
      regions: row.analyses[0].regions.length,
      canvasReads: 0,
      modes: 5,
      viewports: 3,
      missingOverlay: "explicit limitation",
      errors,
    }),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
