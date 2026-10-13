#!/usr/bin/env node
/**
 * Check that every script under scripts/ is discoverable.
 *
 * Usage: node scripts/check-scripts-index.mjs
 *
 * A script is listed when the README.md in its folder, or in a parent folder
 * up to scripts/, names it by its path relative to that README (or by its full
 * `scripts/...` path). Helpers imported or dot-sourced by another non-test
 * script count as listed through it. Tests are exempt. See scripts/README.md.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = /\.(?:[cm]?js|ts|ps1|sh|py)$/;
const TEST = /\.test\.[cm]?[jt]s$|(?:^|\/)test_[^/]*\.py$|_test\.py$/;
const LITERAL = /["'`]([^"'`\s]+\.(?:[cm]?js|ts|ps1|sh|py))["'`]/g;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text, name) =>
  new RegExp(`(?:^|[^\\w./-])${escapeRegExp(name)}(?![\\w-]|\\.\\w)`).test(text);

/** Paths (relative to the repository) of scripts that no README lists. */
export function findUnlisted(files, read) {
  const scripts = files.filter((path) => path.startsWith("scripts/") && SCRIPT.test(path));
  const readmes = new Map(
    files
      .filter((path) => /^scripts\/(?:.+\/)?README\.md$/.test(path))
      .map((path) => [posix.dirname(path), read(path)]),
  );
  const referenced = new Set();
  for (const path of scripts.filter((p) => !TEST.test(p))) {
    for (const [, literal] of read(path).matchAll(LITERAL)) {
      const target = literal.startsWith("scripts/")
        ? literal
        : posix.join(posix.dirname(path), literal);
      if (target !== path) referenced.add(posix.normalize(target));
    }
  }
  return scripts.filter((path) => {
    if (TEST.test(path) || referenced.has(path)) return false;
    for (let dir = posix.dirname(path); dir.startsWith("scripts"); dir = posix.dirname(dir)) {
      const text = readmes.get(dir);
      if (text !== undefined && (mentions(text, posix.relative(dir, path)) || mentions(text, path)))
        return false;
      if (dir === "scripts") break;
    }
    return true;
  });
}

function main() {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "scripts"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  const files = [...new Set(out.split("\0").filter(Boolean))];
  const read = (path) => {
    try {
      return readFileSync(join(ROOT, path), "utf8");
    } catch {
      return "";
    }
  };
  const unlisted = findUnlisted(files, read);
  if (unlisted.length === 0) {
    console.log("Every script under scripts/ is listed in a README.");
    return;
  }
  for (const path of unlisted) {
    const dir = posix.dirname(path);
    const where = dir === "scripts" ? "scripts/README.md" : `${dir}/README.md or scripts/README.md`;
    console.error(`${path}: not listed in ${where}`);
  }
  console.error(
    `${unlisted.length} unlisted script(s). Add a line to the nearest README (see scripts/README.md).`,
  );
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
