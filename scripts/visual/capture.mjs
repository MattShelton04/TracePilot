import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { captureExitCode, chromiumArgs, stableScreenshot } from "./capture-policy.mjs";
import { fixtureCorpusPlugin } from "./fixture-plugin.mjs";
import { writeLocalGallery } from "./local-gallery.mjs";
import { fixedTime, selectCases, viewport } from "./manifest.mjs";
import { selectReadmeCases } from "./readme-manifest.mjs";
import { sectionId } from "./sections.mjs";
import { releaseManifestFixture } from "./update-fixtures.mjs";
import { assertWorktreeLayout } from "./worktree-assertions.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((value) => value.replace(/^--/, "").split(/=(.*)/s)),
);
const root = resolve(args.root ?? ".");
const output = resolve(args.out ?? ".tracepilot/visual");
const shard = args.shard ?? "1/1";
const revision = args.revision ?? "head";
captureExitCode([], revision); // Validate before starting the browser or Vite.
// `--suite=readme` captures the README screenshots from the showcase fixture.
const readmeSuite = args.suite === "readme";
if (args.suite && !readmeSuite) throw new Error(`Unknown suite: ${args.suite}`);
const selected = readmeSuite
  ? selectReadmeCases(args.case?.split(","))
  : selectCases(shard, { group: args.group, caseIds: args.case?.split(",") });
if (!selected.length) throw new Error("No visual cases selected");
const captureViewport = args.viewport
  ? (() => {
      const match = /^(1440x960|960x640|2560x1440)$/.exec(args.viewport);
      if (!match) throw new Error("--viewport must be 1440x960, 960x640 or 2560x1440");
      const [width, height] = match[1].split("x").map(Number);
      return { width, height };
    })()
  : viewport;
const app = resolve(root, "apps/desktop");
const readmeVersion = readmeSuite
  ? JSON.parse(await readFile(resolve(app, "package.json"), "utf8")).version
  : null;
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
const commit = (cwd) =>
  execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
const revisionSha = commit(root);
const harnessSha = commit(harnessRoot);
if (process.env.VISUAL_REVISION_SHA && process.env.VISUAL_REVISION_SHA !== revisionSha)
  throw new Error("Visual checkout does not match the requested revision");
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
    fs: { allow: [root, dirname(fixtureFile), resolve(harnessRoot, "scripts/fixtures")] },
  },
  plugins: [
    fixtureCorpusPlugin({ targetRoot: root, harnessRoot }),
    {
      name: "visual-fixtures-only",
      enforce: "pre",
      async transform(source, id) {
        if (!id.replaceAll("\\", "/").endsWith("/packages/client/src/invoke.ts")) return;
        const marker = /\): Promise<T> => \{\r?\n/;
        if (!marker.test(source))
          throw new Error(
            "Visual fixture adapter no longer matches createInvoke; update the harness.",
          );
        return `import { visualInvoke } from ${JSON.stringify(fixtureImport)};\n${source.replace(marker, (match) => `${match}    return visualInvoke(cmd, args, fallback);\n`)}`;
      },
    },
    ...(readmeSuite ? [readmeVersionPlugin(readmeVersion)] : []),
  ],
});
try {
  await server.listen();
  const address = server.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    ...(args.channel ? { channel: args.channel } : {}),
    args: chromiumArgs,
  });
  for (const item of selected) {
    // Historical task/web_fetch results used the plain fallback. Keep those
    // before-images comparable without relaxing current renderer assertions.
    const readySelector =
      revision === "base" && ["task-fallback", "web-fetch-fallback"].includes(item.fixture)
        ? ".plain-text-renderer, .tool-markdown-result"
        : item.ready;
    const context = await browser.newContext({
      viewport: captureViewport,
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
    });
    // A fixture page cannot call the real network or attach to the native app.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      // Release notes change every release; captures read a fixed manifest.
      if (url.origin === baseUrl && url.pathname === "/release-manifest.json")
        return route.fulfill({ json: releaseManifestFixture });
      if (url.origin === baseUrl) return route.continue();
      // Web search normally requests remote source favicons. Supply a fixed,
      // neutral icon locally; no external fetch, failed request or brand asset.
      if (url.hostname === "icons.duckduckgo.com" && url.pathname === "/ip3/example.com.ico")
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="none" stroke="gray"/><path d="M2 6h8M6 2v8" stroke="gray"/></svg>',
        });
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 300));
    });
    await page.clock.setFixedTime(new Date(item.fixedTime ?? fixedTime));
    await page.addInitScript((features) => {
      window.__TRACEPILOT_VISUAL_FEATURES__ = features;
    }, item.features ?? []);
    await page.addInitScript((fixture) => {
      window.__TRACEPILOT_VISUAL_CASE__ = fixture;
    }, item.fixture);
    await page.addInitScript(() => {
      // The app's global handler can log a null Error object for browser-only
      // errors (for example ResizeObserver). Retain the actual event message.
      window.__TRACEPILOT_VISUAL_ERRORS__ = [];
      window.addEventListener("error", (event) => {
        window.__TRACEPILOT_VISUAL_ERRORS__.push({
          message: event.message,
          source: event.filename,
          line: event.lineno,
        });
      });
      localStorage.setItem("tracepilot-theme", "dark");
      localStorage.setItem("tracepilot-last-seen-version", "999.0.0");
      let seed = 42;
      Math.random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
    });
    // The release-notes dialog opens when the version differs from the last seen.
    if (readmeVersion)
      await page.addInitScript((version) => {
        localStorage.setItem("tracepilot-last-seen-version", version);
      }, readmeVersion);
    const result = {
      id: item.id,
      group: sectionId(item),
      route: item.route,
      state: item.state,
      features: item.features ?? [],
      fixedTime: item.fixedTime ?? fixedTime,
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
        .locator(item.start ?? readySelector)
        .first()
        .waitFor({ state: "visible", timeout: 15000 });
      if (item.prepare === "open-plan") {
        await page.locator(".fb-tree__item").filter({ hasText: "plan.md" }).click();
      } else if (item.prepare === "compare-sessions") {
        await page.getByLabel("Select Session A").selectOption("sess-search-polish");
        await page.getByLabel("Select Session B").selectOption("sess-auth-refactor");
        await page.getByRole("button", { name: "Compare", exact: true }).click();
      } else if (item.prepare === "sidebar-click") {
        // Open update surfaces from the sidebar, as a user would. Labels are
        // matched case-insensitively so earlier revisions' capitalisation works.
        const scope = page.locator(item.within ?? ".sidebar-footer-area");
        const target = item.button
          ? scope.getByRole("button", { name: new RegExp(`^${item.button}$`, "i") })
          : scope.locator(item.target);
        await target.first().waitFor({ state: "visible", timeout: 15000 });
        await target.first().click();
      } else if (item.prepare === "actions") {
        for (const action of item.actions) await runAction(page, action);
      } else if (item.prepare === "agent-usage") {
        await page.getByRole("tab", { name: /^Usage/ }).click();
      } else if (item.prepare === "rich-tool") {
        await page.getByRole("button", { name: "Timeline", exact: true }).click();
        await page.locator(".tool-call-item").first().click();
        if (item.openArgs) {
          const argsToggle = page.locator('.args-toggle[aria-expanded="false"]');
          if (await argsToggle.count()) await argsToggle.first().click();
        }
        for (const action of item.actions ?? []) {
          if (action.type === "full") {
            const buttons = page.getByRole("button", {
              name: /^(?:Load full output|Show Full Output)$/,
            });
            await buttons.first().waitFor({ state: "visible" });
            // The base may contain the duplicate controls this PR fixes. Use
            // one to load the same content; require a single owner at head.
            if (revision === "head" && (await buttons.count()) !== 1)
              throw new Error("A preview must offer exactly one full-output action");
            await buttons.first().click();
            await page.waitForFunction(
              () => window.__TRACEPILOT_VISUAL__?.calls.get_tool_result > 0,
            );
            await page.locator(".rs-trunc-row").waitFor({ state: "hidden" });
          } else await runAction(page, action);
        }
      }
      await page.locator(readySelector).first().waitFor({ state: "visible", timeout: 15000 });
      if (item.command)
        await page.waitForFunction(
          (cmd) => window.__TRACEPILOT_VISUAL__?.calls[cmd] > 0,
          item.command,
        );
      if (page.url().split("#")[1] !== item.route)
        throw new Error(`Unexpected route redirect: ${page.url().split("#")[1]}`);
      if (item.scrollText)
        await page.getByText(item.scrollText, { exact: true }).first().scrollIntoViewIfNeeded();
      if (item.assertion === "worktree-layout") await assertWorktreeLayout(page);
      if (item.assertion === "complete-web-search") {
        if ((await page.locator(".ws-source-card").count()) !== 2)
          throw new Error(
            "Complete web search must render both source cards from its JSON envelope",
          );
        if (
          await page
            .getByRole("button", { name: /^(?:Load full output|Show Full Output)$/ })
            .count()
        )
          throw new Error("Web search must render completely without manual output loading");
      }
      if (item.group === "rich-tools") {
        if (item.expectText) {
          // Paging and lazy result replacement update Vue on the next render.
          // Wait for the sentinel instead of racing an immediate DOM read.
          await page
            .waitForFunction(
              (expected) =>
                Array.from(document.querySelectorAll(".rs__body"))
                  .map((element) => element.textContent ?? "")
                  .join("\n")
                  .includes(expected),
              item.expectText,
              { timeout: 15000 },
            )
            .catch(() => {
              throw new Error(`Expected complete result text: ${item.expectText}`);
            });
        }
      }
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
      if (item.group === "rich-tools") {
        // A preceding click must not leave incidental hover styling in the capture.
        await page.mouse.move(0, 0);
        // Frame only after fonts and expansion layout settle. End fixtures show
        // one call: use the page bottom, matching the conversation's scroll lock,
        // rather than racing its ResizeObserver with a different card-end target.
        const anchor = page.locator(item.focus === "end" ? ".rs" : ".tool-call-item").last();
        await anchor.evaluate(async (element, end) => {
          if (end) {
            const container = element.closest(".page-content");
            if (!container)
              throw new Error("Rich-tool end capture requires a page scroll container");
            container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
          } else {
            // Keep the call header below the sticky session toolbar.
            element.style.scrollMarginTop = "112px";
            element.scrollIntoView({ block: "start", behavior: "instant" });
          }
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        }, item.focus === "end");
        if (item.focus === "end")
          await page.waitForFunction(() => {
            const container = document.querySelector(".rs")?.closest(".page-content");
            return (
              container &&
              container.scrollHeight - container.scrollTop - container.clientHeight <= 1
            );
          });
      }
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
      const browserErrors = await page.evaluate(() => window.__TRACEPILOT_VISUAL_ERRORS__ ?? []);
      for (const error of browserErrors)
        errors.push(
          `Browser error: ${error.message} (${error.source}:${error.line})`.slice(0, 500),
        );
      if (errors.length || result.missingFixtures.length) result.status = "incomplete";
    } catch (error) {
      result.status = "failed";
      result.errors.push(String(error.message).slice(0, 500));
      // Failure captures are diagnostic, never accepted as a visual baseline.
      await page
        .screenshot({
          path: resolve(output, `${item.id}.png`),
          animations: "disabled",
        })
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
        revisionSha,
        harnessSha,
        viewport: captureViewport,
        fixedTime,
        shard,
        durationMs: Math.round(performance.now() - started),
        cases: reports,
      },
      null,
      2,
    ),
  );
  if (Object.hasOwn(args, "gallery")) await writeLocalGallery(output, reports, captureViewport);
  if (readmeSuite && Object.hasOwn(args, "docs")) {
    const captured = reports.filter((row) => row.status === "captured");
    for (const report of captured)
      await copyFile(
        resolve(output, `${report.id}.png`),
        resolve(root, `docs/images/${report.id}.png`),
      );
    console.log(`Copied ${captured.length} README images to docs/images`);
  }
}
process.exitCode = captureExitCode(reports, revision);

async function runAction(page, action) {
  if (action.type === "select") {
    const option = action.value != null ? { value: action.value } : { label: action.option };
    await page.getByLabel(action.label, { exact: true }).selectOption(option);
  } else if (action.type === "fill") {
    await page.getByLabel(action.label, { exact: true }).fill(action.value);
  } else if (action.type === "scroll") {
    // Bring a deliberate region into view inside the page's scroll container.
    await page
      .locator(action.selector)
      .first()
      .evaluate((element, offset) => {
        const container = element.closest(".page-content") ?? document.scrollingElement;
        const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
        container.scrollTo({ top: container.scrollTop + top - offset, behavior: "instant" });
      }, action.offset ?? 0);
  } else if (action.type === "button") {
    const scope = action.within ? page.locator(action.within) : page;
    const button = scope.getByRole("button", { name: action.name, exact: true });
    const element = await button.elementHandle();
    await button.click();
    if (action.name.startsWith("Show ") && (await element.getAttribute("aria-expanded")) !== "true")
      throw new Error(`Disclosure did not expand: ${action.name}`);
  } else throw new Error(`Unknown capture action: ${action.type}`);
}

/** README captures show the workspace version instead of browser mode's "dev". */
function readmeVersionPlugin(version) {
  return {
    name: "readme-app-version",
    enforce: "pre",
    transform(source, id) {
      if (!id.replaceAll("\\", "/").endsWith("/apps/desktop/src/lib/tauri/app.ts")) return;
      const marker = "if (!isTauri()) return null;";
      if (!source.includes(marker))
        throw new Error(
          "README version stub no longer matches getTauriAppVersion; update the harness.",
        );
      return source.replace(marker, `if (!isTauri()) return ${JSON.stringify(version)};`);
    },
  };
}
