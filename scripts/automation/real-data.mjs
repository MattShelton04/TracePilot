// Mirrors the maintainer's real session sources into an isolated instance data root
// for `app:start -Instance <name> -RealData`. Files are hard-linked (no extra disk
// space, and appends by a running CLI stay visible); SQLite sidecars, files that
// cannot be linked and other volumes are copied. The sources are only read: links
// are created and removed in the data root, never in the source trees. TracePilot's
// own config, index and app state stay under the data root, away from the real ones.
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MARKER = "real-data.json";
const COPY_ALWAYS = /-(wal|shm|journal)$|\.lock$/i;

export function realSources(env = process.env, home = homedir()) {
  const copilotHome = env.COPILOT_HOME || join(home, ".copilot");
  const claudeHome = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  // Claude Code's settings.json, credentials and sessions/*.key are never mirrored.
  return [
    { source: join(copilotHome, "session-state"), target: "copilot/session-state" },
    { source: join(claudeHome, "projects"), target: "claude/projects" },
    { source: join(claudeHome, "plans"), target: "claude/plans" },
    { source: join(claudeHome, "file-history"), target: "claude/file-history" },
  ];
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function sameFile(left, right) {
  return left.ino === right.ino && left.dev === right.dev && left.ino !== 0n;
}

// Mirrors `source` into `target`. Redirected entries (symlinks, junctions) are skipped.
export function mirror(source, target, counts) {
  mkdirSync(target, { recursive: true });
  const wanted = new Set();
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    let stat;
    try {
      stat = lstatSync(from, { bigint: true });
    } catch {
      continue; // Removed while mirroring.
    }
    if (stat.isSymbolicLink()) continue;
    wanted.add(entry.name);
    const existing = existsSync(to) ? lstatSync(to, { bigint: true }) : null;
    if (stat.isDirectory()) {
      if (existing && !existing.isDirectory()) rmSync(to, { force: true });
      mirror(from, to, counts);
      continue;
    }
    if (!stat.isFile()) continue;
    const copy = COPY_ALWAYS.test(entry.name);
    if (existing && !copy && existing.isFile() && sameFile(existing, stat)) {
      counts.kept++;
      continue;
    }
    if (existing) rmSync(to, { recursive: true, force: true });
    try {
      if (copy) throw new Error("copy");
      linkSync(from, to);
      counts.linked++;
    } catch {
      try {
        copyFileSync(from, to);
        counts.copied++;
      } catch {
        counts.skipped++; // Locked or removed while mirroring.
      }
    }
  }
  for (const name of readdirSync(target)) {
    if (wanted.has(name)) continue;
    // Removing a link never touches the source file it shares.
    rmSync(join(target, name), { recursive: true, force: true });
    counts.removed++;
  }
}

export function syncRealData(root, sources = realSources()) {
  if (!isAbsolute(root)) throw new Error(`--root must be absolute: ${root}`);
  if (existsSync(join(root, "synthetic-fixtures.json"))) {
    throw new Error(`${root} holds synthetic fixtures. Use a fresh -Instance name for -RealData.`);
  }
  const counts = { linked: 0, copied: 0, kept: 0, removed: 0, skipped: 0 };
  const mirrored = [];
  for (const { source, target } of sources) {
    const destination = join(root, target);
    if (inside(source, root) || inside(root, source)) {
      throw new Error(`Real-data source and data root overlap: ${source} / ${root}`);
    }
    if (!existsSync(source) || !lstatSync(source).isDirectory()) {
      // An empty folder keeps Claude Code discovery from failing on a missing root.
      mkdirSync(destination, { recursive: true });
      continue;
    }
    mirror(source, destination, counts);
    mirrored.push(source);
  }
  const sessions = (dir) => (existsSync(dir) ? readdirSync(dir).length : 0);
  const result = {
    owner: "tracepilot-real-data",
    sources: mirrored,
    copilotSessions: sessions(join(root, "copilot/session-state")),
    claudeProjects: sessions(join(root, "claude/projects")),
    ...counts,
  };
  writeFileSync(join(root, MARKER), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.find((value) => value.startsWith("--root="));
  try {
    if (!arg) throw new Error("Usage: node scripts/automation/real-data.mjs --root=<data root>");
    console.log(JSON.stringify(syncRealData(arg.slice("--root=".length))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
