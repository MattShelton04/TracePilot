/**
 * Advice for `pnpm check:changed`: notes for changes its targeted checks can't
 * cover, and non-failing hints for slower checks a change probably affects
 * (native e2e specs that reference removed UI text, visual capture cases for
 * changed views). Hints are heuristics; they never fail the run.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";

const RUST_CONFIG =
  /^(?:Cargo\.(?:toml|lock)|rust-toolchain\.toml|\.cargo\/|\.config\/hakari\.toml)/;

/** Advice for changes the targeted checks can't cover. */
export const NOTES = [
  {
    match: (f) => RUST_CONFIG.test(f.path),
    text: "Rust build or dependency configuration changed: the PR's CI runs the full gate; run `just ci` locally only if you aren't confident it passes.",
  },
  {
    match: (f) => f.path.startsWith("crates/tracepilot-tauri-bindings/"),
    text: "IPC crate changed: if a command or type crosses IPC, run `pnpm gen:bindings` and commit the output.",
  },
  {
    match: (f) => /^packages\/(?:ui|client|types)\/src\//.test(f.path),
    text: "Shared package changed: if its public API changed for other workspaces, the PR's CI runs the full gate; run `just ci` locally only if you aren't confident it passes.",
  },
  {
    match: (f) => f.path.startsWith("site/"),
    text: "Site changed: for layout changes also run `pnpm site:build` and `pnpm site:check` (docs/landing-page.md).",
  },
];

const NOT_TEST = (path) => !/(?:^|\/)__tests__\/|\.(?:test|spec)\.\w+$/.test(path);
/** Frontend source whose removed text can break the native e2e specs. */
const FRONTEND = /^(?:apps\/desktop\/src|packages\/ui\/src)\/.+\.(?:vue|ts)$/;
const VIEWS = "apps/desktop/src/views/";
const ROUTER = "apps/desktop/src/router/";
const SESSION_TABS = "apps/desktop/src/config/sessionTabs.ts";
// Above this many cases in one visual section, suggest the whole section.
const MAX_CASES = 6;
const MAX_TEXTS = 3;

const QUOTED = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
const TEXT_NODE = />([^<>]+)</g;
const TEXT_LINE = /^\s*([A-Za-z][^<>{}=;()]*)$/;

/** Whether some removed text looks like a visible label or test id, not code. */
export function isLabel(text) {
  if (text.length < 4 || text.length > 120 || !/[A-Za-z]/.test(text)) return false;
  if (/^[./@#-]|\$\{|=>|::/.test(text)) return false;
  return /\s/.test(text) || /^[A-Z]/.test(text) || /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(text);
}

function labelsIn(line, vue) {
  const found = [];
  for (const [, , text] of line.matchAll(QUOTED)) found.push(text);
  if (vue) {
    for (const [, text] of line.matchAll(TEXT_NODE)) found.push(text);
    const whole = TEXT_LINE.exec(line);
    if (whole && !/["'`]/.test(whole[1])) found.push(whole[1]);
  }
  // Mustache interpolations split visible text: `{{ n }} total events`.
  return found
    .flatMap((text) => text.split(/\{\{.*?\}\}/))
    .map((text) => text.trim())
    .filter(isLabel);
}

/**
 * Text removed from frontend source in a unified diff, minus text the diff
 * adds back elsewhere (a move or re-wrap rather than a removal).
 */
export function removedLabels(diff) {
  const removed = new Set();
  const added = new Set();
  let file = null;
  let inHunk = false;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      file = /^diff --git a\/(.+?) b\//.exec(line)?.[1] ?? null;
      inHunk = false;
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && file && FRONTEND.test(file) && NOT_TEST(file)) {
      const sign = line[0];
      if (sign !== "-" && sign !== "+") continue;
      const into = sign === "-" ? removed : added;
      for (const text of labelsIn(line.slice(1), file.endsWith(".vue"))) into.add(text);
    }
  }
  return [...removed].filter((text) => !added.has(text)).sort();
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Spec files that reference removed text. `stillPresent(text)` reports text
 * the frontend source still contains elsewhere, which can't break a spec.
 */
export function e2eReferences(diff, specs, stillPresent = () => false) {
  const hits = new Map();
  for (const text of removedLabels(diff)) {
    const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(text)}(?![\\w-])`);
    const specPaths = specs.filter((spec) => pattern.test(spec.text)).map((spec) => spec.path);
    if (specPaths.length === 0 || stillPresent(text)) continue;
    for (const path of specPaths) hits.set(path, [...(hits.get(path) ?? []), text]);
  }
  return [...hits].sort(([a], [b]) => a.localeCompare(b));
}

export function e2eHints(diff, specs, stillPresent) {
  return e2eReferences(diff, specs, stillPresent).map(([path, texts]) => {
    const shown = texts.slice(0, MAX_TEXTS).map((text) => JSON.stringify(text));
    const more = texts.length > MAX_TEXTS ? ` and ${texts.length - MAX_TEXTS} more` : "";
    return `e2e: ${path} references removed text ${shown.join(", ")}${more}; update the spec or run \`pnpm test:e2e\` (tests/e2e/README.md).`;
  });
}

/**
 * Route records (`path` → view file) from the router and the session-tab
 * registry. Routes with children also match the paths below them.
 */
export function parseRoutes(routerSource, tabsSource = "") {
  const views = new Map();
  for (const [, name, view] of routerSource.matchAll(
    /const\s+(\w+)\s*=\s*\(\)\s*=>\s*import\("@\/views\/([^"]+)"\)/g,
  ))
    views.set(name, view);
  const routes = [];
  const chunks = (source, key) => source.split(new RegExp(`\\b(?=${key}:\\s*")`)).slice(1);
  for (const chunk of chunks(routerSource, "path")) {
    const path = /^path:\s*"([^"]*)"/.exec(chunk)?.[1];
    const component = /component:\s*(?:\(\)\s*=>\s*import\("@\/views\/([^"]+)"\)|(\w+))/.exec(
      chunk,
    );
    const view = component?.[1] ?? views.get(component?.[2]);
    if (path?.startsWith("/") && view)
      routes.push({ path, view: VIEWS + view, nested: /\bchildren:/.test(chunk) });
  }
  for (const chunk of chunks(tabsSource, "name")) {
    const name = /^name:\s*"([^"]+)"/.exec(chunk)?.[1];
    const view = /component:\s*\(\)\s*=>\s*import\("@\/views\/([^"]+)"\)/.exec(chunk)?.[1];
    if (name && view) routes.push({ path: `/session/:id/${name}`, view: VIEWS + view });
  }
  return routes;
}

function routePattern(route) {
  if (/\(\.\*\)/.test(route.path)) return null; // the catch-all
  let source = "";
  for (const segment of route.path.split("/").filter(Boolean)) {
    if (/^:\w+\?$/.test(segment)) source += "(?:/[^/]+)?";
    else if (segment.startsWith(":")) source += "/[^/]+";
    else source += `/${escapeRegExp(segment)}`;
  }
  return new RegExp(`^${source || "/"}${route.nested ? "(?:/.*)?" : ""}$`);
}

/** The views a case renders: every matching route's (a parent and its tab), else the catch-all's. */
function viewsForCase(item, routes) {
  const path = item.route.split("?")[0];
  const matched = routes.filter((route) => routePattern(route)?.test(path));
  const chosen = matched.length ? matched : routes.filter((route) => !routePattern(route));
  return chosen.map((route) => route.view);
}

/** Route views a changed view file belongs to. */
function viewsFor(path, routes, read) {
  const views = new Set(routes.map((route) => route.view));
  if (views.has(path)) return [path];
  // A file in a subfolder belongs to the view in the parent folder named after
  // it (views/orchestration/home/* → OrchestrationHomeView.vue).
  const dir = posix.dirname(path);
  const folder = posix.basename(dir).toLowerCase();
  const byFolder = [...views].filter(
    (view) =>
      posix.dirname(view) === posix.dirname(dir) &&
      posix.basename(view).toLowerCase().includes(folder),
  );
  if (byFolder.length) return byFolder;
  // Otherwise, to the views that name it.
  const name = posix.basename(path).replace(/\.\w+$/, "");
  return [...views].filter((view) => {
    try {
      return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(read(view));
    } catch {
      return false;
    }
  });
}

/** Visual case ids for changed views and router files, in manifest order. */
export function visualCaseIds(paths, { cases, routes, read = () => "" }) {
  const changed = paths.filter(NOT_TEST);
  if (changed.some((path) => path.startsWith(ROUTER) || path === SESSION_TABS))
    return cases.map((item) => item.id);
  const views = new Set(
    changed.filter((path) => path.startsWith(VIEWS)).flatMap((p) => viewsFor(p, routes, read)),
  );
  return cases
    .filter((item) => viewsForCase(item, routes).some((view) => views.has(view)))
    .map((item) => item.id);
}

export function visualHints(paths, { cases, routes, read, sectionOf }) {
  const ids = new Set(visualCaseIds(paths, { cases, routes, read }));
  const bySection = new Map();
  for (const item of cases.filter((c) => ids.has(c.id))) {
    const section = sectionOf(item);
    bySection.set(section, [...(bySection.get(section) ?? []), item.id]);
  }
  return [...bySection].map(([section, sectionIds]) => {
    const select =
      sectionIds.length > MAX_CASES ? `--group=${section}` : `--case=${sectionIds.join(",")}`;
    return `visual: changed views render in ${sectionIds.length} capture case(s): node scripts/visual/capture.mjs ${select} (setup: docs/visual-regression.md#local-use-and-adding-cases).`;
  });
}

function readText(root, path) {
  return readFileSync(join(root, path), "utf8");
}

function e2eFromRepo(root, mergeBase) {
  const diff = execFileSync(
    "git",
    [
      "diff",
      "-U0",
      "--no-color",
      "--no-renames",
      mergeBase,
      "--",
      "apps/desktop/src",
      "packages/ui/src",
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const specs = readdirSync(join(root, "tests/e2e"))
    .filter((name) => name.endsWith(".mjs") && name !== "playwright.config.mjs")
    .map((name) => `tests/e2e/${name}`)
    .map((path) => ({ path, text: readText(root, path) }));
  const stillPresent = (text) => {
    try {
      execFileSync(
        "git",
        [
          "grep",
          "-q",
          "-F",
          "-e",
          text,
          "--",
          ":(glob)apps/desktop/src/**",
          ":(glob)packages/ui/src/**",
          ":!*.test.ts",
          ":!**/__tests__/**",
        ],
        { cwd: root, stdio: "ignore" },
      );
      return true;
    } catch {
      return false;
    }
  };
  return e2eHints(diff, specs, stillPresent);
}

async function visualFromRepo(root, paths) {
  const load = (path) => import(pathToFileURL(join(root, path)).href);
  const [{ cases }, { sectionId }] = await Promise.all([
    load("scripts/visual/manifest.mjs"),
    load("scripts/visual/sections.mjs"),
  ]);
  const routes = parseRoutes(readText(root, `${ROUTER}index.ts`), readText(root, SESSION_TABS));
  const read = (path) => readText(root, path);
  return visualHints(paths, { cases, routes, read, sectionOf: sectionId });
}

/** Hints for the changed files. Never throws: a hint that can't be worked out is skipped. */
export async function collectHints({ root, mergeBase, files }) {
  const hints = [];
  const live = files.filter(NOT_TEST);
  const attempt = async (label, compute) => {
    try {
      hints.push(...(await compute()));
    } catch (error) {
      hints.push(`${label}: could not check (${error.message.split("\n")[0]}).`);
    }
  };
  if (live.some((path) => FRONTEND.test(path)))
    await attempt("e2e", () => e2eFromRepo(root, mergeBase));
  if (
    live.some((path) => path.startsWith(VIEWS) || path.startsWith(ROUTER) || path === SESSION_TABS)
  )
    await attempt("visual", () => visualFromRepo(root, live));
  return hints;
}
