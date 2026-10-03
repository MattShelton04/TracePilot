import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { isReserved, planPublish } from "./ownership.mjs";
import { publish } from "./publish.mjs";

test("reserved paths are visual/, dev/, .nojekyll, README.md and the manifest", () => {
  for (const p of [
    "visual/index.html",
    "visual",
    "dev/bench/data.js",
    ".nojekyll",
    "README.md",
    ".site-manifest.json",
  ]) {
    assert.ok(isReserved(p), p);
  }
  for (const p of [
    "index.html",
    "assets/main.js",
    "demo/index.html",
    "visualize.html",
    "developer.html",
  ]) {
    assert.ok(!isReserved(p), p);
  }
});

test("stale owned files are removed and foreign files are left alone", () => {
  const plan = planPublish({
    owned: ["index.html", "assets/old.js"],
    next: ["index.html", "assets/new.js"],
    existing: ["index.html", "assets/old.js", "visual/index.html", "README.md", ".nojekyll"],
  });
  assert.deepEqual(plan.remove, ["assets/old.js"]);
  assert.deepEqual(plan.write, ["assets/new.js", "index.html"]);
  assert.deepEqual(plan.manifest.files, ["assets/new.js", "index.html"]);
});

test("a build that collides with reserved or unowned files fails", () => {
  assert.throws(
    () => planPublish({ owned: [], next: ["visual/index.html"], existing: [] }),
    /collides with reserved paths/,
  );
  assert.throws(
    () => planPublish({ owned: [], next: ["index.html"], existing: ["index.html"] }),
    /does not own: index.html/,
  );
  assert.throws(
    () => planPublish({ owned: ["dev/bench/index.html"], next: [], existing: [] }),
    /Manifest claims reserved paths/,
  );
});

test("manifest paths cannot escape the worktree or alias reserved paths", () => {
  for (const p of [
    "../index.html",
    "/index.html",
    "assets/../visual/x",
    "assets\\x",
    "C:/x",
    "x\nREADME.md",
    "x//y",
    "x/./y",
  ]) {
    for (const key of ["owned", "next"]) {
      assert.throws(
        () => planPublish({ owned: [], next: [], existing: [], [key]: [p] }),
        /unsafe path/,
      );
    }
  }
  for (const p of ["VISUAL/x", "README.md/x", ".nojekyll/x", ".git/config"]) {
    assert.throws(() => planPublish({ owned: [], next: [p], existing: [] }), /reserved paths/);
  }
  assert.throws(() => planPublish({ owned: null, next: [], existing: [] }), /array of paths/);
});

test("file/directory collisions fail before any changes are applied", () => {
  for (const [next, existing] of [
    [["assets/a.js"], ["assets"]],
    [["assets"], ["assets/foreign.txt"]],
    [["assets", "assets/a.js"], []],
  ]) {
    assert.throws(() => planPublish({ owned: [], next, existing }), /file\/directory collision/);
  }
});

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
const put = (root, files) => {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
};

test("publishing into a scratch gh-pages keeps visual/ and dev/, and is idempotent", () => {
  const base = mkdtempSync(join(tmpdir(), "site-publish-"));
  try {
    const remote = join(base, "remote.git");
    git(base, "init", "--bare", "-q", "-b", "main", remote);
    const seed = join(base, "seed");
    git(base, "clone", "-q", remote, seed);
    git(seed, "checkout", "-q", "--orphan", "gh-pages");
    put(seed, {
      ".nojekyll": "",
      "README.md": "pages",
      "visual/index.html": "gallery",
      "dev/bench/data.js": "x",
    });
    git(seed, "add", "-A");
    git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");
    git(seed, "push", "-q", "origin", "gh-pages");

    const work = join(base, "work");
    git(base, "clone", "-q", remote, work);
    const dist = join(base, "dist");
    put(dist, { "index.html": "v1", "assets/a.js": "a" });
    assert.equal(publish({ cwd: work, dist, sha: "one" }).pushed, true);

    put(dist, { "index.html": "v2", "assets/b.js": "b" });
    rmSync(join(dist, "assets/a.js"));
    assert.equal(publish({ cwd: work, dist, sha: "two" }).pushed, true);
    assert.equal(
      publish({ cwd: work, dist, sha: "three" }).changed,
      false,
      "an unchanged build makes no commit",
    );

    const files = git(remote, "ls-tree", "-r", "--name-only", "gh-pages").trim().split("\n").sort();
    assert.deepEqual(files, [
      ".nojekyll",
      ".site-manifest.json",
      "README.md",
      "assets/b.js",
      "dev/bench/data.js",
      "index.html",
      "visual/index.html",
    ]);
    assert.equal(git(remote, "show", "gh-pages:index.html"), "v2");
    assert.match(git(remote, "log", "-1", "--format=%s", "gh-pages"), /Publish site for two/);
    const manifest = JSON.parse(git(remote, "show", "gh-pages:.site-manifest.json"));
    assert.deepEqual(manifest.files, ["assets/b.js", "index.html"]);
    assert.ok(readFileSync(join(dist, "index.html"), "utf8") === "v2");

    // Move the remote between fetch and push, as a concurrent gallery publisher would.
    const hookScript = join(base, "concurrent.mjs");
    writeFileSync(
      hookScript,
      `
      import { execFileSync } from 'node:child_process';
      import { existsSync, writeFileSync } from 'node:fs';
      const marker = ${JSON.stringify(join(base, "moved"))};
      if (!existsSync(marker)) {
        writeFileSync(marker, 'done');
        const git = (...args) => execFileSync('git', args, {
          cwd: ${JSON.stringify(seed)}, stdio: 'pipe',
          env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
        });
        git('fetch', 'origin', 'gh-pages');
        git('reset', '--hard', 'FETCH_HEAD');
        writeFileSync(${JSON.stringify(join(seed, "visual/index.html"))}, 'concurrent gallery');
        git('add', 'visual/index.html');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'Gallery update');
        git('push', 'origin', 'gh-pages');
      }
    `,
    );
    const hook = join(work, ".git/hooks/pre-push");
    const quote = (p) => `'${p.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;
    writeFileSync(hook, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(hookScript)}\n`);
    chmodSync(hook, 0o755);
    put(dist, { "index.html": "v3" });
    assert.equal(publish({ cwd: work, dist, sha: "four" }).pushed, true);
    assert.equal(git(remote, "show", "gh-pages:index.html"), "v3");
    assert.equal(git(remote, "show", "gh-pages:visual/index.html"), "concurrent gallery");
  } finally {
    assert.equal(dirname(base), tmpdir(), "cleanup stays in the scratch directory");
    rmSync(base, { recursive: true, force: true });
  }
});
