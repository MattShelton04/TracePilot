// Quoting-safe front end for the pinned Playwright CLI, for any shell:
//   pnpm pw <instance>[:ui] <playwright-cli command> [args...]
// It finds the instance's CLI session and endpoint from its lifecycle state, attaches
// on first use (`attach` re-attaches after a Rust restart), and runs the CLI through node
// with an argument array, so no cmd/pnpm shim re-parses quotes. JavaScript can come
// from a file: `eval-file <path> [target]` and `run-file <path>`. `resize 1440x960`
// is accepted as `resize 1440 960`. Everything else is passed through unchanged.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const INSTANCE = /^([a-z0-9][a-z0-9-]{0,31})(:ui)?$/;
const USAGE =
  "Usage: pnpm pw <instance>[:ui] <command> [args...]  (instance 'default' = the unnamed launcher)";
const NO_ATTACH = new Set(["attach", "open", "detach", "close", "list", "close-all", "kill-all"]);
const NOT_ATTACHED = /is not open/;

export function resolveTarget(spec, root = repoRoot) {
  const match = INSTANCE.exec(spec ?? "");
  if (!match) throw new Error(`Invalid instance '${spec ?? ""}'. ${USAGE}`);
  const [, name, ui] = match;
  const named = name !== "default";
  const directory = named
    ? join(root, ".tracepilot/instances", name)
    : join(root, ".tracepilot/automation");
  const mode = ui ? "ui" : "desktop";
  const statePath = join(directory, `${mode}.json`);
  if (!existsSync(statePath)) {
    const start = ui
      ? `pnpm app:ui${named ? ` -Instance ${name}` : ""}`
      : `pnpm app:start${named ? ` -Instance ${name} -Fixtures` : ""}`;
    throw new Error(`No tracked ${mode} instance '${name}'. Start it first: ${start}`);
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const session = !named
    ? `tracepilot-${mode}`
    : ui
      ? `tracepilot-${name}-ui`
      : `tracepilot-${name}`;
  const attach = ui
    ? ["open", state.url, "--browser=msedge"]
    : ["attach", `--cdp=${state.endpoint}`];
  return { session, attach };
}

// pnpm runs scripts from the repository root; INIT_CWD is where the caller was.
const readScript = (path) =>
  readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), path), "utf8").trim();

export function translate([command, ...args], target) {
  if (!command) throw new Error(USAGE);
  if (command === "attach" && args.length === 0) return target.attach;
  if (command === "eval-file") {
    if (!args[0])
      throw new Error("eval-file needs a file containing a function, e.g. () => document.title");
    return ["eval", readScript(args[0]), ...args.slice(1)];
  }
  if (command === "run-file") {
    if (!args[0]) throw new Error("run-file needs a file containing async page => { ... }");
    return ["run-code", readScript(args[0]), ...args.slice(1)];
  }
  const size = command === "resize" && args.length === 1 && /^(\d+)[xX,](\d+)$/.exec(args[0]);
  if (size) return ["resize", size[1], size[2]];
  return [command, ...args];
}

export function run(
  argv,
  { root = repoRoot, cli, write = process.stdout, writeError = process.stderr } = {},
) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const target = resolveTarget(args[0], root);
  const command = translate(args.slice(1), target);
  const entry = cli ?? createRequire(import.meta.url).resolve("@playwright/cli/playwright-cli.js");
  const invoke = (cliArgs) => {
    const result = spawnSync(process.execPath, [entry, `-s=${target.session}`, ...cliArgs], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    return result;
  };
  // A bare desktop `attach` replaces a session left over from before a Rust restart.
  if (args.length === 2 && args[1] === "attach" && target.attach[0] === "attach") {
    invoke(["detach"]);
  }
  let result = invoke(command);
  if (
    result.status !== 0 &&
    !NO_ATTACH.has(command[0]) &&
    NOT_ATTACHED.test(`${result.stdout}${result.stderr}`)
  ) {
    // The command did not run because this session is not attached yet.
    const attached = invoke(target.attach);
    if (attached.status !== 0) {
      write.write(attached.stdout);
      writeError.write(attached.stderr);
      return attached.status ?? 1;
    }
    result = invoke(command);
  }
  write.write(result.stdout);
  writeError.write(result.stderr);
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
