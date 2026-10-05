import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

function fixture(t, checkout, contents) {
  const scratch = mkdtempSync(join(tmpdir(), "tracepilot-doc-links-"));
  t.after(() => {
    assert.equal(dirname(scratch), resolve(tmpdir()));
    rmSync(scratch, { recursive: true, force: true });
  });
  const root = join(scratch, checkout);
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(
    new URL("./check-doc-links.mjs", import.meta.url),
    join(root, "scripts/check-doc-links.mjs"),
  );
  writeFileSync(join(root, "README.md"), contents);
  writeFileSync(join(root, "target.txt"), "Existing link target\n");
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  return {
    root,
    run: (...files) =>
      spawnSync(process.execPath, ["scripts/check-doc-links.mjs", ...files], {
        cwd: root,
        encoding: "utf8",
      }),
  };
}

for (const checkout of ["ordinary", "spaces café #checkout"]) {
  for (const mode of ["explicit", "full repository"]) {
    for (const broken of [false, true]) {
      test(`${checkout}: ${mode} ${broken ? "reports a broken link" : "accepts a valid link"}`, (t) => {
        const target = broken ? "missing.md" : "target.txt";
        const { run } = fixture(t, checkout, `[Link](${target})\n`);
        const result = run(...(mode === "explicit" ? ["README.md"] : []));
        assert.equal(result.status, broken ? 1 : 0, result.stderr);
        if (broken) {
          assert.match(result.stderr, /README\.md:1\s+→\s+missing\.md/);
        } else {
          assert.match(result.stdout, /doc-link check passed \(1 file\(s\)\)/);
        }
      });
    }
  }
}

test("explicit missing source files remain skipped", (t) => {
  const { run } = fixture(t, "ordinary", "[Link](target.txt)\n");
  const result = run("README.md", "deleted.md");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /doc-link check passed \(2 file\(s\)\)/);
});

test("full repository checks omit tracked source files deleted from disk", (t) => {
  const { root, run } = fixture(t, "ordinary", "[Link](missing.md)\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  rmSync(join(root, "README.md"));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /doc-link check passed \(0 file\(s\)\)/);
});
