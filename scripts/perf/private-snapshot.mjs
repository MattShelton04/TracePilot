/** Copy a fixed subset of explicitly authorized local logs for private profiling.
 * Contents and resulting screenshots must remain under ignored .tracepilot/.
 * This never edits source logs or uses this corpus in CI/public artifacts.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const source = resolve(process.argv[2] ?? "");
assert(
  process.argv[2] && isAbsolute(process.argv[2]),
  "Pass the absolute session-state source directory",
);
const root = resolve(".tracepilot/perf/private-local");
assert(!existsSync(root), "Refusing to overwrite the private snapshot");
const inventory = readdirSync(source, { withFileTypes: true })
  .filter(
    (item) => item.isDirectory() && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(item.name),
  )
  .flatMap((item) => {
    const path = join(source, item.name, "events.jsonl");
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) return [];
    const info = statSync(path);
    return [{ id: item.name, bytes: info.size, modified: info.mtimeMs }];
  });
assert(inventory.length, "No session logs found");
const ordered = [...inventory].sort((a, b) => b.bytes - a.bytes);
const recent = [...inventory].sort((a, b) => b.modified - a.modified);
const selected = new Map();
for (const item of [
  ...ordered.slice(0, 4),
  ...recent.slice(0, 8),
  ...Array.from(
    { length: 8 },
    (_, index) => ordered[Math.floor(((index + 1) * ordered.length) / 9)],
  ),
]) {
  selected.set(item.id, item);
}
mkdirSync(join(root, "copilot/session-state"), { recursive: true });
mkdirSync(join(root, "tracepilot"));
const snapshots = [];
for (const item of selected.values()) {
  const destination = join(root, "copilot/session-state", item.id);
  mkdirSync(destination);
  const files = [];
  for (const name of ["events.jsonl", "workspace.yaml"]) {
    const original = join(source, item.id, name);
    if (!existsSync(original)) continue;
    assert(!lstatSync(original).isSymbolicLink());
    const resolved = realpathSync(original);
    const difference = relative(realpathSync(source), resolved);
    assert(difference && !isAbsolute(difference) && !difference.startsWith(`..${sep}`));
    const before = statSync(original);
    const target = join(destination, name);
    copyFileSync(original, target);
    const after = statSync(original);
    const contents = readFileSync(target);
    files.push({
      name,
      bytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
      sourceChangedDuringCopy: before.size !== after.size || before.mtimeMs !== after.mtimeMs,
    });
  }
  snapshots.push({ ...item, files });
}
const quote = (path) => JSON.stringify(path);
writeFileSync(
  join(root, "tracepilot/config.toml"),
  `version = 11
[paths]
copilotHome = ${quote(join(root, "copilot"))}
tracepilotHome = ${quote(join(root, "tracepilot"))}
sessionStateDir = ${quote(join(root, "copilot/session-state"))}
indexDbPath = ${quote(join(root, "tracepilot/index.db"))}
[general]
setupComplete = true
[ui]
theme = "dark"
autoRefreshEnabled = false
`,
);
writeFileSync(
  join(root, "private-source-manifest.json"),
  JSON.stringify(
    {
      private: true,
      root,
      source,
      selection: "4 largest, 8 recent, 8 size quantiles, deduplicated",
      sourceSessions: inventory.length,
      sessions: snapshots,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    root,
    sessions: snapshots.length,
    totalMiB:
      snapshots.reduce(
        (sum, item) => sum + item.files.reduce((total, file) => total + file.bytes, 0),
        0,
      ) / 1048576,
    private: true,
  }),
);
