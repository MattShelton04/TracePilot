import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { ago } from "../src/lib/format.js";
import {
  beaconTag,
  cspFor,
  fillPlaceholders,
  MAC_NOTE,
  pickDownload,
  platformScript,
  SHOW_COUNTS_FROM,
  socialFacts,
} from "./html-facts.mjs";
import { fromRelease, pickInstallers, releaseHighlights, repoStats } from "./release-data.mjs";
import { validateShowcase } from "./validate-data.mjs";

const generated = new URL("../src/data/showcase.json", import.meta.url);

test("the generated showcase data passes validation", () => {
  validateShowcase(JSON.parse(readFileSync(generated, "utf8")));
});

test("validation lists every drifted field instead of rendering a broken page", () => {
  assert.throws(
    () => validateShowcase({ sessions: [], heroTurns: {} }),
    (error) =>
      /no longer matches the showcase fixtures/.test(error.message) &&
      /sessionCount/.test(error.message) &&
      /tool call "agent-review"/.test(error.message) &&
      /heroTodos ids/.test(error.message),
  );
});

test("validation catches a renamed todo in otherwise valid data", () => {
  const data = JSON.parse(readFileSync(generated, "utf8"));
  data.heroTodos.todos[0].id = "renamed";
  assert.throws(() => validateShowcase(data), /heroTodos ids/);
});

const asset = (name) => ({ name, browser_download_url: `https://example.test/${name}`, size: 1 });

test("the Windows installer is the NSIS setup exe, then the MSI, never the bare binary", () => {
  const exe = asset("tracepilot-desktop.exe");
  const msi = asset("TracePilot_0.9.0_x64_en-US.msi");
  const nsis = asset("TracePilot_0.9.0_x64-setup.exe");
  assert.equal(pickInstallers([exe, msi, nsis]).windows.name, nsis.name);
  assert.equal(pickInstallers([exe, msi]).windows.name, msi.name);
  assert.equal(pickInstallers([exe]).windows, null);
});

test("the macOS installer is the Apple Silicon disk image, not the updater archive", () => {
  const dmg = asset("TracePilot_0.9.1_aarch64.dmg");
  const updater = asset("TracePilot_0.9.1_aarch64.app.tar.gz");
  assert.equal(pickInstallers([updater, dmg]).macos.name, dmg.name);
  assert.equal(pickInstallers([updater]).macos, null);
});

test("release data strips the tag prefix and links the always-current latest release", () => {
  const data = fromRelease({
    tag_name: "v1.2.3",
    published_at: "2026-10-01T00:00:00Z",
    html_url: "https://example.test/releases/tag/v1.2.3",
    assets: [asset("TracePilot_1.2.3_x64-setup.exe")],
  });
  assert.equal(data.version, "1.2.3");
  assert.equal(data.installers.windows.name, "TracePilot_1.2.3_x64-setup.exe");
  assert.equal(data.installers.macos, null);
  assert.match(data.page, /\/releases\/latest$/);
});

const links = {
  win: "https://example.test/win",
  mac: "https://example.test/mac",
  page: "https://example.test/rel",
};

test("each platform gets its installer, and anything else the release page", () => {
  const pick = (nav, l = links) => pickDownload(nav, l);
  assert.deepEqual(pick({ platform: "Win32" }), { os: "win", url: links.win });
  assert.deepEqual(pick({ userAgentData: { platform: "Windows" } }), { os: "win", url: links.win });
  assert.deepEqual(pick({ platform: "MacIntel", maxTouchPoints: 0 }), {
    os: "mac",
    url: links.mac,
  });
  assert.deepEqual(pick({ userAgentData: { platform: "macOS" } }), { os: "mac", url: links.mac });
  // iPadOS reports MacIntel; a touch screen gives it away
  assert.deepEqual(pick({ platform: "MacIntel", maxTouchPoints: 5 }), {
    os: "other",
    url: links.page,
  });
  for (const platform of ["Linux x86_64", "iPhone", "Android", ""]) {
    assert.deepEqual(pick({ platform }), { os: "other", url: links.page });
  }
  // a release without a disk image (before macOS builds) sends Macs to the release page
  assert.deepEqual(pick({ platform: "MacIntel" }, { ...links, mac: null }), {
    os: "other",
    url: links.page,
  });
});

test("the head script labels the page and points static download links at the installer", () => {
  const release = {
    page: links.page,
    installers: { windows: { url: links.win }, macos: { url: links.mac } },
  };
  const run = (platform) => {
    const dataset = {};
    const anchors = [{ href: links.page }, { href: links.page }];
    let ready;
    const document = {
      documentElement: { dataset },
      addEventListener: (type, fn) => {
        if (type === "DOMContentLoaded") ready = fn;
      },
      querySelectorAll: (sel) => (sel === "a[data-download]" ? anchors : []),
    };
    runInNewContext(platformScript(release), { document, navigator: { platform } });
    ready();
    return { dataset, anchors };
  };
  const mac = run("MacIntel");
  assert.deepEqual(mac.dataset, { os: "mac", download: links.mac });
  assert.ok(mac.anchors.every((a) => a.href === links.mac && a.title === MAC_NOTE));
  const linux = run("Linux x86_64");
  assert.deepEqual(linux.dataset, { os: "other", download: links.page });
  assert.ok(linux.anchors.every((a) => a.href === links.page && a.title === undefined));
});

test("placeholders are filled, and unknown ones fail the build", () => {
  assert.equal(fillPlaceholders("v__version__", { version: "1.0.0" }, "x.html"), "v1.0.0");
  assert.throws(() => fillPlaceholders("__nope__", {}, "x.html"), /unknown placeholder __nope__/);
  assert.throws(() => fillPlaceholders("__future_fact2__", {}, "x.html"), /unknown placeholder/);
  assert.throws(() => fillPlaceholders("__constructor__", {}, "x.html"), /unknown placeholder/);
});

test("the CSP admits the analytics beacon only when asked, and only in builds", () => {
  const hash = "'sha256-abc'";
  const plain = cspFor("build", [hash]);
  assert.match(plain, /script-src 'self' 'sha256-abc';/);
  assert.match(plain, /connect-src 'none'/);
  assert.doesNotMatch(plain, /cloudflareinsights/);
  const beacon = cspFor("build", [hash], true);
  assert.match(beacon, /script-src 'self' https:\/\/static\.cloudflareinsights\.com 'sha256-abc';/);
  assert.match(beacon, /connect-src https:\/\/cloudflareinsights\.com;/);
  assert.throws(() => cspFor("serve", [], true), /builds only/);
});

test("the beacon tag carries a well-formed token and nothing else", () => {
  const token = "0123456789abcdef0123456789abcdef";
  const { attrs } = beaconTag(token);
  assert.equal(attrs.src, "https://static.cloudflareinsights.com/beacon.min.js");
  assert.deepEqual(JSON.parse(attrs["data-cf-beacon"]), { token });
  for (const bad of ["", "xyz", `${token}"><script>`, token.toUpperCase()]) {
    assert.throws(() => beaconTag(bad), /32 hex characters/);
  }
});

test("release highlights are the Added titles, or every title when nothing was added", () => {
  const notes = [
    "### Added",
    "",
    "- **Live terminal sessions** — Watch sessions as they happen (#853).",
    "- **Agents explorer** — Lists agents (#831).",
    "### Fixed",
    "- **Large sessions** — Metrics stay responsive.",
  ].join("\r\n");
  assert.deepEqual(releaseHighlights(notes), ["Live terminal sessions", "Agents explorer"]);
  assert.deepEqual(releaseHighlights("### Fixed\n- **Session Explorer copying** — Restored."), [
    "Session Explorer copying",
  ]);
  assert.deepEqual(releaseHighlights(""), []);
  const many = Array.from({ length: 9 }, (_, i) => `- **Item ${i}** — x`).join("\n");
  assert.equal(releaseHighlights(`### Added\n${many}`).length, 6);
});

test("repository stats count installer downloads across releases, not updater files", () => {
  const dl = (name, download_count) => ({ name, download_count });
  const stats = repoStats({ stargazers_count: 12 }, [
    {
      published_at: "2026-09-27T00:00:00Z",
      assets: [dl("TracePilot_0.9.0_x64-setup.exe", 40), dl("latest.json", 900), dl("a.sig", 5)],
    },
    { published_at: "2026-03-21T00:00:00Z", prerelease: true, assets: [dl("x.msi", 2)] },
    { published_at: "2026-03-18T00:00:00Z", assets: [dl("TracePilot_0.2.0_aarch64.dmg", 3)] },
    { published_at: "2026-01-01T00:00:00Z", draft: true, assets: [] },
  ]);
  assert.deepEqual(stats, {
    stars: 12,
    downloads: 45,
    releases: 2,
    firstReleaseAt: "2026-03-18T00:00:00Z",
  });
});

test("counts stay out of the page until they pass their thresholds", () => {
  const release = (stars, downloads) => ({
    publishedAt: "2026-09-27T11:19:49Z",
    highlights: ["Live <terminal> sessions", "`/model` changes"],
    stats: { stars, downloads, releases: 19, firstReleaseAt: "2026-03-18T13:15:33Z" },
  });
  const low = socialFacts(release(12, 122));
  assert.equal(low.starCount, "");
  assert.equal(low.downloadCount, "");
  const high = socialFacts(release(SHOW_COUNTS_FROM.stars, SHOW_COUNTS_FROM.downloads + 1234));
  assert.equal(high.starCount, String(SHOW_COUNTS_FROM.stars));
  assert.match(high.downloadCount, /^[\d.]+K downloads$/);
  assert.equal(low.releaseWhen, "released 27 Sep 2026");
  assert.equal(low.releaseCadence, "19 releases since March 2026");
  assert.equal(
    low.releaseHighlights,
    "<li>Live &lt;terminal&gt; sessions</li><li>/model changes</li>",
  );
});

test("without release dates or stats the facts degrade to plain labels", () => {
  const facts = socialFacts({ publishedAt: null, stats: null });
  assert.deepEqual(facts, {
    releaseDate: "",
    releaseWhen: "latest release",
    releaseHighlights: "",
    releaseCadence: "",
    starCount: "",
    downloadCount: "",
  });
});

test("release dates read as days, then weeks, then months ago", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const before = (days) => new Date(now - days * 864e5).toISOString();
  assert.equal(ago(before(0), now), "today");
  assert.equal(ago(before(1), now), "yesterday");
  assert.equal(ago(before(8), now), "8 days ago");
  assert.equal(ago(before(21), now), "3 weeks ago");
  assert.equal(ago(before(95), now), "3 months ago");
  // a clock behind the release never reads as the future
  assert.equal(ago(before(-2), now), "today");
});
