import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { captureExitCode, stableScreenshot } from "./capture-policy.mjs";
import { fixedTime, selectCases, viewport } from "./manifest.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((value) => value.replace(/^--/, "").split(/=(.*)/s)),
);
const root = resolve(args.root ?? ".");
const output = resolve(args.out ?? ".tracepilot/visual");
const shard = args.shard ?? "1/1";
const revision = args.revision ?? "head";
captureExitCode([], revision); // Validate before starting the browser or Vite.
const selected = selectCases(shard).filter((item) => !args.case || item.id === args.case);
if (!selected.length) throw new Error("No visual cases selected");
const app = resolve(root, "apps/desktop");
const requireApp = createRequire(resolve(app, "package.json"));
const requireHarness = createRequire(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"),
);
const { createServer } = await import(pathToFileURL(requireApp.resolve("vite")).href);
// Both target revisions use the head harness's exact browser package/version.
const { chromium } = requireHarness("playwright-core");
const fixtureFile = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures.mjs");
const fixtureImport = `/@fs/${fixtureFile.replaceAll("\\", "/")}`;
const harnessRoot = resolve(dirname(fixtureFile), "../..");
const reports = [];
const started = performance.now();
await mkdir(output, { recursive: true });
let browser;
const server = await createServer({
  root: app,
  configFile: resolve(app, "vite.config.ts"),
  cacheDir: resolve(root, ".tracepilot/visual-vite-cache"),
  server: {
    host: "127.0.0.1",
    port: Number(args.port ?? 0),
    strictPort: true,
    fs: { allow: [root, dirname(fixtureFile)] },
  },
  plugins: [
    {
      name: "visual-fixtures-only",
      enforce: "pre",
      async transform(source, id) {
        const corpus = /\/packages\/client\/src\/(mock\/[^?]+\.ts|internal\/mockData\.ts)$/.exec(
          id.replaceAll("\\", "/"),
        );
        if (corpus) {
          // Freeze imported fallback datasets to the same head harness on both
          // targets, while keeping each target's real client/component logic.
          return readFile(resolve(harnessRoot, "packages/client/src", corpus[1]), "utf8");
        }
        if (!id.replaceAll("\\", "/").endsWith("/packages/client/src/invoke.ts")) return;
        const marker = /\): Promise<T> => \{\r?\n/;
        if (!marker.test(source))
          throw new Error(
            "Visual fixture adapter no longer matches createInvoke; update the harness.",
          );
        return `import { visualInvoke } from ${JSON.stringify(fixtureImport)};\n${source.replace(marker, (match) => `${match}    return visualInvoke(cmd, args, fallback);\n`)}`;
      },
    },
  ],
});
try {
  await server.listen();
  const address = server.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch(args.channel ? { channel: args.channel } : {});
  for (const item of selected) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
    });
    // A fixture page cannot call the real network or attach to the native app.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 300));
    });
    await page.clock.setFixedTime(new Date(fixedTime));
    await page.addInitScript((features) => {
      window.__TRACEPILOT_VISUAL_FEATURES__ = features;
    }, item.features ?? []);
    await page.addInitScript(() => {
      localStorage.setItem("tracepilot-theme", "dark");
      localStorage.setItem("tracepilot-last-seen-version", "999.0.0");
      let seed = 42;
      Math.random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
    });
    const result = {
      id: item.id,
      route: item.route,
      state: item.state,
      features: item.features ?? [],
      status: "captured",
      errors,
    };
    const caseStarted = performance.now();
    try {
      await page.goto(`${baseUrl}/#${item.route}`);
      await page.waitForFunction(() => window.__TRACEPILOT_VISUAL__?.pending === 0, undefined, {
        timeout: 15000,
      });
      await page
        .locator(item.start ?? item.ready)
        .first()
        .waitFor({ state: "visible", timeout: 15000 });
      if (item.prepare === "open-plan") {
        await page.locator(".fb-tree__item").filter({ hasText: "plan.md" }).click();
      } else if (item.prepare === "compare-sessions") {
        await page.getByLabel("Select Session A").selectOption("sess-search-polish");
        await page.getByLabel("Select Session B").selectOption("sess-auth-refactor");
        await page.getByRole("button", { name: "Compare", exact: true }).click();
      }
      await page.locator(item.ready).first().waitFor({ state: "visible", timeout: 15000 });
      if (item.command)
        await page.waitForFunction(
          (cmd) => window.__TRACEPILOT_VISUAL__?.calls[cmd] > 0,
          item.command,
        );
      if (page.url().split("#")[1] !== item.route)
        throw new Error(`Unexpected route redirect: ${page.url().split("#")[1]}`);
      if (item.scrollText)
        await page.getByText(item.scrollText, { exact: true }).first().scrollIntoViewIfNeeded();
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}",
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      await page.waitForFunction(() => window.__TRACEPILOT_VISUAL__?.pending === 0);
      if (await page.locator(".error-boundary").count())
        errors.push(
          `Visible error boundary: ${(await page.locator(".error-boundary").first().innerText()).slice(0, 300)}`,
        );
      const file = `${item.id}.png`;
      const { png, attempts } = await stableScreenshot(() =>
        page.screenshot({
          animations: "disabled",
          caret: "hide",
        }),
      );
      await writeFile(resolve(output, file), png);
      result.screenshotAttempts = attempts;
      result.sha256 = createHash("sha256").update(png).digest("hex");
      result.missingFixtures = await page.evaluate(
        () => window.__TRACEPILOT_VISUAL__?.missing ?? [],
      );
      if (errors.length || result.missingFixtures.length) result.status = "incomplete";
    } catch (error) {
      result.status = "failed";
      result.errors.push(String(error.message).slice(0, 500));
      // Failure captures are diagnostic, never accepted as a visual baseline.
      await page
        .screenshot({ path: resolve(output, `${item.id}.png`), animations: "disabled" })
        .catch(() => {});
    }
    result.durationMs = Math.round(performance.now() - caseStarted);
    reports.push(result);
    console.log(`${item.id}: ${result.status}`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
  await writeFile(
    resolve(output, `capture-${shard.replace("/", "-")}.json`),
    JSON.stringify(
      {
        schema: 1,
        revision,
        viewport,
        fixedTime,
        shard,
        durationMs: Math.round(performance.now() - started),
        cases: reports,
      },
      null,
      2,
    ),
  );
}
process.exitCode = captureExitCode(reports, revision);
