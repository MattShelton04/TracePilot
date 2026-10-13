import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveTarget, run, translate } from "./pw.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-pw-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = (dir, mode, value) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, `${mode}.json`), JSON.stringify(value));
  };
  state(".tracepilot/instances/qa1", "desktop", { endpoint: "http://127.0.0.1:9241" });
  state(".tracepilot/instances/qa1", "ui", { url: "http://127.0.0.1:1441" });
  state(".tracepilot/automation", "desktop", { endpoint: "http://127.0.0.1:9222" });
  return root;
}

test("resolves the session and attach command from lifecycle state", (t) => {
  const root = fixture(t);
  assert.deepEqual(resolveTarget("qa1", root), {
    session: "tracepilot-qa1",
    attach: ["attach", "--cdp=http://127.0.0.1:9241"],
  });
  assert.deepEqual(resolveTarget("qa1:ui", root), {
    session: "tracepilot-qa1-ui",
    attach: ["open", "http://127.0.0.1:1441", "--browser=msedge"],
  });
  assert.equal(resolveTarget("default", root).session, "tracepilot-desktop");
  assert.throws(() => resolveTarget("missing", root), /app:start -Instance missing -Fixtures/);
  assert.throws(() => resolveTarget("Bad_Name", root), /Invalid instance/);
  assert.throws(() => resolveTarget(undefined, root), /Usage/);
});

test("translates file-based JavaScript and WxH resize", (t) => {
  const root = fixture(t);
  const script = join(root, "probe.js");
  writeFileSync(script, "() => document.querySelector(`[title=\"a 'b'\"]`)?.textContent\n");
  const target = { attach: ["attach", "--cdp=x"] };
  assert.deepEqual(translate(["eval-file", script, "e3"], target), [
    "eval",
    "() => document.querySelector(`[title=\"a 'b'\"]`)?.textContent",
    "e3",
  ]);
  assert.equal(translate(["run-file", script], target)[0], "run-code");
  assert.deepEqual(translate(["resize", "1440x960"], target), ["resize", "1440", "960"]);
  assert.deepEqual(translate(["resize", "960", "640"], target), ["resize", "960", "640"]);
  assert.deepEqual(translate(["attach"], target), ["attach", "--cdp=x"]);
  assert.deepEqual(translate(["click", "e12"], target), ["click", "e12"]);
});

test("passes arguments verbatim and attaches once when the session is not open", (t) => {
  const root = fixture(t);
  const log = join(root, "calls.jsonl");
  const cli = join(root, "fake-cli.cjs");
  // Records argv; reports "not open" until an attach has happened.
  writeFileSync(
    cli,
    `const fs = require('node:fs');
     const args = process.argv.slice(2);
     fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
     const flag = ${JSON.stringify(join(root, "attached"))};
     if (args[1] === 'attach') { fs.writeFileSync(flag, ''); process.exit(0); }
     if (args[1] === 'detach') process.exit(0);
     if (!fs.existsSync(flag)) { console.log("The browser 'x' is not open"); process.exit(1); }
     console.log('ok');`,
  );
  const tricky = `() => "double" + 'single' + \`tick\` + " & | ^ % ! <>"`;
  const output = [];
  const sink = { write: (text) => output.push(text) };
  const status = run(["--", "qa1", "eval", tricky], { root, cli, write: sink, writeError: sink });
  assert.equal(status, 0);
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls, [
    ["-s=tracepilot-qa1", "eval", tricky],
    ["-s=tracepilot-qa1", "attach", "--cdp=http://127.0.0.1:9241"],
    ["-s=tracepilot-qa1", "eval", tricky],
  ]);
  assert.match(output.join(""), /ok/);
});
