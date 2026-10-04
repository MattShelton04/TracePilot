import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { beaconTag, cspFor, fillPlaceholders } from "./html-facts.mjs";
import { fromRelease, pickInstaller } from "./release-data.mjs";
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

test("the installer is the NSIS setup exe, then the MSI, never the bare binary", () => {
  const exe = asset("tracepilot-desktop.exe");
  const msi = asset("TracePilot_0.9.0_x64_en-US.msi");
  const nsis = asset("TracePilot_0.9.0_x64-setup.exe");
  assert.equal(pickInstaller([exe, msi, nsis]).name, nsis.name);
  assert.equal(pickInstaller([exe, msi]).name, msi.name);
  assert.equal(pickInstaller([exe]), null);
});

test("release data strips the tag prefix and keeps the release page", () => {
  const data = fromRelease({
    tag_name: "v1.2.3",
    published_at: "2026-10-01T00:00:00Z",
    html_url: "https://example.test/releases/tag/v1.2.3",
    assets: [asset("TracePilot_1.2.3_x64-setup.exe")],
  });
  assert.equal(data.version, "1.2.3");
  assert.equal(data.installer.name, "TracePilot_1.2.3_x64-setup.exe");
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
