// Browser checks for the built site (CI and local): `pnpm site:check` after `pnpm site:build`.
// Serves dist/ with `vite preview`, drives Chromium through every supported viewport,
// fails on errors, third-party requests, overflow and broken interactions, checks the analytics
// beacon is present exactly when CF_BEACON_TOKEN is set (stubbed, so checks never count as visits),
// enforces the
// size budget in perf-budget.json (`site`), and saves screenshots to site/.check/ for review.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import { checkPlan } from "./check-plan.mjs";
import { pickDownload } from "./html-facts.mjs";
import { startPreview } from "./preview.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".check");
const PORT = 4187;
const BASE = `http://localhost:${PORT}/`;
const VIEWPORTS = checkPlan();
const SECTIONS = [
  "open",
  "conversation",
  "agents",
  "context",
  "launch",
  "more",
  "demo",
  "privacy",
  "start",
];

// Cloudflare Web Analytics: the only third party a page may load, and only in CI builds
const BEACON = process.env.CF_BEACON_TOKEN || "";
const BEACON_HOSTS = /^https:\/\/(static\.)?cloudflareinsights\.com\//;
const BEACON_SCRIPT = "https://static.cloudflareinsights.com/beacon.min.js";

// Every context, including platform-download checks, must stub analytics so
// testing a production beacon never records a visit.
const stubBeacon = (context) =>
  context.route(BEACON_HOSTS, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      headers: { "access-control-allow-origin": "*" },
      body: "",
    }),
  );

const failures = [];
const fail = (where, what) => {
  failures.push(`${where}: ${what}`);
  console.error(`  ✗ ${what}`);
};
const ok = (what) => console.log(`  ✓ ${what}`);

/** The beacon must ship exactly when CI asks for it, with the token it was given. */
function beaconMarkup() {
  console.log("analytics beacon");
  for (const page of ["index.html", "demo/index.html"]) {
    const html = readFileSync(join(root, "dist", page), "utf8");
    const tag = html.match(/<script[^>]*data-cf-beacon="([^"]*)"[^>]*>/);
    if (!BEACON) {
      if (tag) fail("beacon", `${page} has a beacon but CF_BEACON_TOKEN is not set; rebuild`);
      else ok(`${page}: none (CF_BEACON_TOKEN not set)`);
    } else if (!tag || !tag[1].includes(BEACON)) {
      fail("beacon", `${page} lacks the beacon for CF_BEACON_TOKEN; rebuild with it set`);
    } else ok(`${page}: present`);
  }
}

function sizeBudget() {
  const budget = JSON.parse(readFileSync(join(root, "../perf-budget.json"), "utf8")).site;
  const assets = join(root, "dist/assets");
  const gz = (ext) =>
    readdirSync(assets)
      .filter((f) => f.endsWith(ext))
      .reduce((n, f) => n + gzipSync(readFileSync(join(assets, f))).length, 0);
  const data = ["showcase.json", "release.json"].reduce(
    (n, f) => n + gzipSync(readFileSync(join(root, "src/data", f))).length,
    0,
  );
  const measured = {
    jsGzipKb: gz(".js") / 1024,
    cssGzipKb: gz(".css") / 1024,
    dataGzipKb: data / 1024,
  };
  console.log("size budget (gzip)");
  for (const [k, v] of Object.entries(measured)) {
    const line = `${k} ${v.toFixed(1)} KB (budget ${budget[k]} KB)`;
    if (v > budget[k]) fail("budget", line);
    else ok(line);
  }
}

const LABELS = {
  win: "Download for Windows",
  mac: "Download for macOS",
  other: "View latest release",
  none: "Download",
};

/** The labels a download link shows and where every download link points, on both pages. */
async function downloadState(context) {
  const page = await context.newPage();
  // load, not domcontentloaded: without JavaScript nothing waits for the stylesheet
  await page.goto(BASE, { waitUntil: "load" });
  const state = await page.evaluate(() => ({
    labels: [...document.querySelectorAll(".hero-ctas a[data-download]")].map((a) =>
      [...a.querySelectorAll("span")]
        .filter((span) => getComputedStyle(span).display !== "none")
        .map((span) => span.textContent.trim())
        .join("|"),
    ),
    hrefs: [...document.querySelectorAll("a[data-download]")].map((a) => a.href),
    title: document.querySelector("a[data-download]").title,
  }));
  await page.goto(`${BASE}demo/`, { waitUntil: "domcontentloaded" });
  state.hrefs.push(await page.locator("a[data-download]").getAttribute("href"));
  return state;
}

/** Each platform gets its own label and installer; no JavaScript gets the neutral label. */
async function checkPlatforms(browser) {
  console.log("platform downloads");
  const release = JSON.parse(readFileSync(join(root, "src/data/release.json"), "utf8"));
  const links = {
    win: release.installers.windows?.url ?? null,
    mac: release.installers.macos?.url ?? null,
    page: release.page,
  };
  const cases = [
    ["Windows", "Win32", 0],
    ["Mac", "MacIntel", 0],
    ["Linux", "Linux x86_64", 0],
    ["iPad", "MacIntel", 5],
    ["no JavaScript", null, 0],
  ];
  for (const [name, platform, touch] of cases) {
    const context = await browser.newContext({ javaScriptEnabled: platform !== null });
    await stubBeacon(context);
    await context.addInitScript(
      ([p, t]) => {
        const fake = (key, value) =>
          Object.defineProperty(Navigator.prototype, key, { get: () => value });
        fake("platform", p);
        fake("userAgentData", undefined);
        fake("maxTouchPoints", t);
      },
      [platform, touch],
    );
    const want =
      platform === null
        ? { os: "none", url: links.page }
        : pickDownload({ platform, maxTouchPoints: touch }, links);
    const { labels, hrefs, title } = await downloadState(context);
    const where = `downloads (${name})`;
    if (labels.length !== 2 || labels.some((l) => l !== LABELS[want.os]))
      fail(where, `labels ${JSON.stringify(labels)}, expected "${LABELS[want.os]}"`);
    else if (hrefs.length !== 4 || hrefs.some((h) => h !== want.url))
      fail(where, `links ${JSON.stringify(hrefs)}, expected ${want.url}`);
    else if (want.os === "mac" ? !title : title) fail(where, `unexpected link title "${title}"`);
    else ok(`${name}: "${LABELS[want.os]}" → ${want.url.split("/").pop() || want.url}`);
    await context.close();
  }
}

async function openPage(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: vp.reduce ? "reduce" : "no-preference",
    isMobile: !!vp.mobile,
    hasTouch: !!vp.mobile,
  });
  const problems = [];
  const beaconLoads = [];
  await stubBeacon(context);
  context.on("page", (page) => {
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console error: ${m.text().slice(0, 200)}`);
    });
  });
  context.on("requestfailed", (r) =>
    problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`),
  );
  context.on("response", (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  context.on("request", (r) => {
    const url = r.url();
    if (BEACON && BEACON_HOSTS.test(url)) {
      if (url === BEACON_SCRIPT) beaconLoads.push(r.frame().url());
      return;
    }
    if (new URL(url).origin !== new URL(BASE).origin && !/^(data|blob):/.test(url)) {
      problems.push(`third-party request: ${url}`);
    }
  });
  const page = await context.newPage();
  return { context, page, problems, beaconLoads };
}

const settle = (page, ms = 1600) => page.waitForTimeout(ms);
const scrollTo = (page, y) => page.evaluate((v) => window.scrollTo(0, v), y);

async function screenshots(page, vp) {
  const dir = join(out, vp.name);
  mkdirSync(dir, { recursive: true });
  for (const id of SECTIONS) {
    // pinned scenes: look halfway through the pin, where the animation is mid-flight
    const y = await page.evaluate((sid) => {
      const el = document.getElementById(sid);
      const spacer = el.parentElement.classList.contains("pin-spacer") ? el.parentElement : el;
      const top = spacer.getBoundingClientRect().top + scrollY;
      const extra = spacer === el ? 0 : (spacer.offsetHeight - innerHeight) * 0.5;
      return top + extra;
    }, id);
    await scrollTo(page, y);
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) fail(vp.name, `${id}: horizontal overflow of ${overflow}px`);
    await page.screenshot({ path: join(dir, `${id}.png`) });
  }
}

async function checkDialog(page, where) {
  await page.evaluate(() => document.getElementById("more").scrollIntoView());
  await settle(page, 900);
  const tile = page.locator(".tile-open").first();
  await tile.click();
  const dialog = page.locator(".tile-dialog");
  await dialog.waitFor({ state: "visible", timeout: 4000 });
  // the open animation ends by moving focus into the dialog
  await page.waitForFunction(
    () => document.querySelector(".tile-dialog").contains(document.activeElement),
    null,
    { timeout: 4000 },
  );
  const width = await page.evaluate(
    () => document.querySelector(".td-panel").getBoundingClientRect().width,
  );
  const vw = await page.evaluate(() => innerWidth);
  if (width > vw + 0.5)
    fail(where, `bento dialog is ${Math.round(width)}px wide on a ${vw}px viewport`);
  else ok(`bento dialog opens and fits (${Math.round(width)}px of ${vw}px)`);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 4000 });
  const back = await page.evaluate(
    () => document.activeElement === document.querySelector(".tile-open"),
  );
  if (back) ok("Escape closes the dialog and returns focus to its tile");
  else fail(where, "focus did not return to the tile after closing the dialog");
}

async function checkDemo(page, where) {
  await page.evaluate(() => document.getElementById("demo").scrollIntoView());
  await page.locator("#demoHost .rp").waitFor({ timeout: 8000 });
  await page.locator('#demoSteps button[data-i="8"]').click();
  const query = await page.evaluate(
    () => document.querySelector(".tile.t-search [data-type]").dataset.type,
  );
  try {
    await page.waitForFunction(
      (q) => document.querySelector('#demoHost .rp-view[data-view="search"] .q')?.textContent === q,
      query,
      { timeout: 10000 },
    );
    ok("live demo builds and plays the Search stop");
  } catch {
    fail(where, "live demo did not finish the Search stop");
  }
}

async function checkTour(page, where) {
  await scrollTo(page, 0);
  await settle(page, 600);
  await page.locator(".btn-tour").click();
  await settle(page, 1500);
  const running = await page.evaluate(() => ({
    pill: !document.getElementById("tourPill").hidden,
    y: scrollY,
  }));
  if (!running.pill || running.y < 100)
    return fail(where, `tour did not start (scrollY ${running.y})`);
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 40);
  await settle(page, 800);
  const y1 = await page.evaluate(() => scrollY);
  await settle(page, 700);
  const after = await page.evaluate(() => ({
    pill: !document.getElementById("tourPill").hidden,
    y: scrollY,
  }));
  if (after.pill || Math.abs(after.y - y1) > 2) fail(where, "tour did not stop on wheel input");
  else ok("tour auto-scrolls and stops on wheel input");
}

async function checkReduced(page, where) {
  const hero = await page.evaluate(() => {
    const h = document.getElementById("hero-title");
    let o = 1;
    for (let n = h; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    const r = h.getBoundingClientRect();
    return { o, inView: r.top >= 0 && r.bottom <= innerHeight };
  });
  if (hero.o > 0.9 && hero.inView) ok("hero heading is visible");
  else fail(where, `hero heading hidden (opacity ${hero.o.toFixed(2)}, in view ${hero.inView})`);
  const tourButtons = await page.evaluate(
    () => [...document.querySelectorAll("[data-tour]")].filter((b) => b.offsetParent).length,
  );
  if (tourButtons === 0) ok("tour controls are hidden");
  else fail(where, `${tourButtons} tour control(s) shown under reduced motion`);
}

async function run() {
  rmSync(out, { recursive: true, force: true });
  sizeBudget();
  beaconMarkup();
  const preview = await startPreview(root, PORT);
  let browser;
  try {
    browser = await chromium.launch();
    await checkPlatforms(browser);
    for (const vp of VIEWPORTS) {
      console.log(vp.name);
      const { context, page, problems, beaconLoads } = await openPage(browser, vp);
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await settle(page, 2500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) fail(vp.name, `horizontal overflow of ${overflow}px`);
      else ok("no horizontal overflow");
      const pins = await page.locator(".pin-spacer").count();
      const want = !vp.reduce && vp.width >= 900 ? 5 : 0;
      if (pins !== want) fail(vp.name, `${pins} pinned scenes, expected ${want}`);
      else ok(`${pins} pinned scenes`);
      if (vp.reduce) await checkReduced(page, vp.name);
      await screenshots(page, vp);
      if (vp.full) {
        await checkDialog(page, vp.name);
        await checkDemo(page, vp.name);
        if (!vp.mobile) await checkTour(page, vp.name);
      }
      const demo = await context.newPage();
      await demo.goto(`${BASE}demo/`, { waitUntil: "networkidle" });
      await demo.locator("#host .rp").waitFor({ timeout: 8000 });
      const demoOverflow = await demo.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      if (demoOverflow > 0) fail(vp.name, `demo page: horizontal overflow of ${demoOverflow}px`);
      await demo.screenshot({ path: join(out, vp.name, "demo-page.png") });
      for (const p of new Set(problems)) fail(vp.name, p);
      if (!problems.length) ok("no console errors, failed or third-party requests");
      if (BEACON) {
        const missing = [BASE, `${BASE}demo/`].filter((u) => !beaconLoads.includes(u));
        if (missing.length) fail(vp.name, `analytics beacon not loaded on ${missing.join(", ")}`);
        else ok("analytics beacon loads on both pages (stubbed)");
      }
      await context.close();
    }
  } finally {
    await browser?.close();
    preview.kill();
  }
  const shots = readdirSync(out).reduce(
    (n, d) => (statSync(join(out, d)).isDirectory() ? n + readdirSync(join(out, d)).length : n),
    0,
  );
  console.log(`\n${shots} screenshots in site/.check/`);
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("site checks passed");
}

await run();
