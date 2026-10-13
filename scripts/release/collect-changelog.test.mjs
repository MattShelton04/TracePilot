import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeUnreleased, parseFragment, readFragments } from "./collect-changelog.mjs";

const CHANGELOG = `# Changelog

Intro text.

## [Unreleased]

### Changed

- **Existing change** — Already staged.

## [1.0.0] - 2026-01-01

### Fixed

- **Old fix** — Shipped.
`;

const fragment = (text, name) => {
  const parsed = parseFragment(text, name);
  assert.deepEqual(parsed.errors, []);
  return parsed;
};

test("merges bullets into Keep a Changelog order, keeping existing lines", () => {
  const merged = mergeUnreleased(CHANGELOG, [
    fragment("### Fixed\n\n- **Search** — Results stay current (#12).\n"),
    fragment(
      "### Added\n\n- **Export** — New format.\n  Second line.\n\n### Changed\n\n- **Theme** — Darker.\n",
    ),
  ]);
  assert.equal(
    merged,
    `# Changelog

Intro text.

## [Unreleased]

### Added

- **Export** — New format.
  Second line.

### Changed

- **Existing change** — Already staged.
- **Theme** — Darker.

### Fixed

- **Search** — Results stay current (#12).

## [1.0.0] - 2026-01-01

### Fixed

- **Old fix** — Shipped.
`,
  );
});

test("is idempotent: no fragments and repeated bullets change nothing", () => {
  assert.equal(mergeUnreleased(CHANGELOG, []), CHANGELOG);
  const once = mergeUnreleased(CHANGELOG, [fragment("### Fixed\n\n- **A** — B.\n")]);
  assert.equal(mergeUnreleased(once, [fragment("### Fixed\n\n- **A** — B.\n")]), once);
  assert.equal(mergeUnreleased(once, []), once);
});

test("fills an empty Unreleased section and preserves CRLF files", () => {
  const empty = "# Changelog\r\n\r\n## [Unreleased]\r\n\r\n## [1.0.0] - 2026-01-01\r\n";
  assert.equal(mergeUnreleased(empty, []), empty);
  assert.equal(
    mergeUnreleased(empty, [fragment("### Security\r\n\r\n- **Patch** — Fixed.\r\n")]),
    "# Changelog\r\n\r\n## [Unreleased]\r\n\r\n### Security\r\n\r\n- **Patch** — Fixed.\r\n\r\n## [1.0.0] - 2026-01-01\r\n",
  );
});

test("rejects unknown headings and stray text with file and line", () => {
  const { errors } = parseFragment(
    "### Improved\n\n- **X** — Y.\nloose text\n",
    "changelog.d/x.md",
  );
  assert.deepEqual(errors, [
    'changelog.d/x.md:1: unknown heading "### Improved" (use Added, Changed, Deprecated, Removed, Fixed, Security)',
    'changelog.d/x.md:3: bullet before any "### <Section>" heading',
    'changelog.d/x.md:4: expected "### <Section>", "- " bullet or indented continuation, got "loose text"',
  ]);
});

test("rejects empty fragments and headings without bullets", () => {
  assert.match(parseFragment("\n", "a.md").errors[0], /no "### <Section>" headings/);
  assert.match(parseFragment("### Fixed\n", "b.md").errors[0], /has no bullets/);
});

test("requires an Unreleased heading", () => {
  assert.throws(() => mergeUnreleased("# Changelog\n", []), /no `## \[Unreleased\]`/);
});

test("readFragments skips the README and sorts by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "changelog-d-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), "# Not a fragment\n");
  writeFileSync(join(dir, "b.md"), "### Fixed\n\n- **B** — b.\n");
  writeFileSync(join(dir, "a.md"), "### Added\n\n- **A** — a.\n");
  const fragments = readFragments(dir);
  assert.deepEqual(
    fragments.map((f) => [f.name, f.errors.length]),
    [
      ["a.md", 0],
      ["b.md", 0],
    ],
  );
});
