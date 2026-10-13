#!/usr/bin/env node
/**
 * Merge changelog fragments into CHANGELOG.md's [Unreleased] section.
 *
 * Usage: pnpm changelog:collect [--dry-run | --check]
 *
 * Each `changelog.d/<slug>.md` (see changelog.d/README.md) holds Keep a
 * Changelog subsection headings followed by bullets. Collecting appends each
 * bullet to the matching `## [Unreleased]` subsection, in Keep a Changelog
 * order, keeps every existing line, and deletes the merged fragments. Bullets
 * already present are skipped, so rerunning is harmless. `--check` only
 * validates the fragments; `--dry-run` prints the result without writing.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
const UNRELEASED = /^## \[Unreleased\]\s*$/;

/** Parse a fragment into { heading: [entry, ...] }; each entry is an array of lines. */
export function parseFragment(text, name = "fragment") {
  const sections = new Map();
  const errors = [];
  let current;
  let entry;
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      const at = `${name}:${index + 1}`;
      const heading = /^###\s+(.+?)\s*$/.exec(line);
      if (heading) {
        if (!SECTIONS.includes(heading[1])) {
          errors.push(`${at}: unknown heading "### ${heading[1]}" (use ${SECTIONS.join(", ")})`);
          current = undefined;
          return;
        }
        current = sections.get(heading[1]) ?? [];
        sections.set(heading[1], current);
        entry = undefined;
      } else if (/^- \S/.test(line)) {
        if (!current) {
          errors.push(`${at}: bullet before any "### <Section>" heading`);
          return;
        }
        entry = [line.trimEnd()];
        current.push(entry);
      } else if (/^\s{2,}\S/.test(line) && entry) {
        entry.push(line.trimEnd());
      } else if (line.trim() !== "") {
        errors.push(
          `${at}: expected "### <Section>", "- " bullet or indented continuation, got "${line.trim()}"`,
        );
      }
    });
  for (const [heading, entries] of sections) {
    if (entries.length === 0) errors.push(`${name}: "### ${heading}" has no bullets`);
  }
  if (sections.size === 0 && errors.length === 0)
    errors.push(`${name}: no "### <Section>" headings`);
  return { sections, errors };
}

/** Split the [Unreleased] body into its preamble and ordered subsections. */
function parseUnreleased(lines) {
  const preamble = [];
  const subsections = new Map();
  let current = preamble;
  for (const line of lines) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = subsections.get(heading[1]) ?? [];
      subsections.set(heading[1], current);
    } else {
      current.push(line);
    }
  }
  return { preamble, subsections };
}

const trimBlank = (lines) => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
};

/** Return the changelog text with the fragments' bullets merged into [Unreleased]. */
export function mergeUnreleased(changelog, fragments) {
  const eol = changelog.includes("\r\n") ? "\r\n" : "\n";
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => UNRELEASED.test(line));
  if (start < 0) throw new Error("CHANGELOG.md has no `## [Unreleased]` heading");
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end < 0) end = lines.length;

  const { preamble, subsections } = parseUnreleased(lines.slice(start + 1, end));
  for (const fragment of fragments) {
    for (const [heading, entries] of fragment.sections) {
      const existing = subsections.get(heading) ?? [];
      const present = new Set(existing.map((line) => line.trim()));
      for (const entry of entries) {
        if (present.has(entry[0].trim())) continue;
        const body = trimBlank(existing);
        existing.length = 0;
        existing.push(...body, ...entry);
        present.add(entry[0].trim());
      }
      subsections.set(heading, existing);
    }
  }

  const order = [...SECTIONS, ...[...subsections.keys()].filter((h) => !SECTIONS.includes(h))];
  const body = [];
  const intro = trimBlank(preamble);
  if (intro.length) body.push(...intro, "");
  for (const heading of order) {
    const content = trimBlank(subsections.get(heading) ?? []);
    if (!subsections.has(heading)) continue;
    body.push(`### ${heading}`, "");
    if (content.length) body.push(...content, "");
  }
  const rest = lines.slice(end);
  const merged = [...lines.slice(0, start + 1), "", ...body, ...rest];
  // An [Unreleased] section at the end of the file keeps a single trailing newline.
  if (rest.length === 0)
    while (merged.length > 1 && merged.at(-1) === "" && merged.at(-2) === "") merged.pop();
  return merged.join(eol);
}

export function readFragments(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort()
    .map((name) => {
      const path = join(dir, name);
      return { name, path, ...parseFragment(readFileSync(path, "utf8"), `changelog.d/${name}`) };
    });
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !["--dry-run", "--check"].includes(arg));
  if (unknown.length) {
    console.error(
      `Unknown argument: ${unknown[0]}\nUsage: pnpm changelog:collect [--dry-run | --check]`,
    );
    process.exit(2);
  }
  const fragments = readFragments(join(ROOT, "changelog.d"));
  const errors = fragments.flatMap((fragment) => fragment.errors);
  if (errors.length) {
    for (const error of errors) console.error(error);
    console.error(`${errors.length} problem(s) in changelog fragments; see changelog.d/README.md.`);
    process.exit(1);
  }
  if (args.includes("--check")) {
    console.log(`${fragments.length} changelog fragment(s) OK.`);
    return;
  }
  if (fragments.length === 0) {
    console.log("No changelog fragments to collect.");
    return;
  }
  const changelogPath = join(ROOT, "CHANGELOG.md");
  const before = readFileSync(changelogPath, "utf8");
  const after = mergeUnreleased(before, fragments);
  if (args.includes("--dry-run")) {
    const lines = after.split(/\r?\n/);
    const start = lines.findIndex((line) => UNRELEASED.test(line));
    const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
    console.log(lines.slice(start, end < 0 ? undefined : end).join("\n"));
    console.log(`Would merge and delete: ${fragments.map((f) => f.name).join(", ")}`);
    return;
  }
  if (after !== before) writeFileSync(changelogPath, after);
  for (const fragment of fragments) rmSync(fragment.path);
  console.log(
    `Merged ${fragments.length} fragment(s) into CHANGELOG.md [Unreleased] and deleted them.`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
