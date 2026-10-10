/**
 * Pop-out (viewer) windows run with the narrow capability in
 * `src-tauri/capabilities/viewer.json` (ADR 0011). A command that pop-out code
 * calls but that file does not grant fails at runtime with "not allowed",
 * usually silently. This test derives the commands pop-out code can reach from
 * the sources (see `viewerIpcReach.ts`) and requires each one to be either
 * granted or listed below as main-window-only, with the reason it is never
 * called in a pop-out.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeViewerReach, DESKTOP_ROOT, type ViewerReach } from "./viewerIpcReach";

/**
 * Commands pop-out code imports but never calls in a pop-out. Keep each reason
 * true: hide or skip the trigger with `useWindowRole().isViewer()` (preferred
 * for anything that writes, launches or spawns), or grant the command in
 * `viewer.json` if a pop-out legitimately needs it.
 */
const MAIN_WINDOW_ONLY: Record<string, string> = {
  context_capture_cancel: "ContextTab mounts the capture panel only in the main window",
  context_capture_delete: "ContextTab mounts the capture panel only in the main window",
  context_capture_get: "ContextTab mounts the capture panel only in the main window",
  context_capture_list: "ContextTab mounts the capture panel only in the main window",
  context_capture_preflight: "ContextTab mounts the capture panel only in the main window",
  context_capture_start: "ContextTab mounts the capture panel only in the main window",
  factory_reset: "preferences reset, called only from Settings",
  save_config: "one-time legacy localStorage migration, which the main window runs at startup",
  update_config: "pop-outs never persist preferences (stores/preferences/persistence.ts)",
  reindex_sessions: "sessions store reindex, called only from the session list",
  open_in_explorer: "Open Folder actions are hidden in pop-outs (SessionDetailPanel, ExplorerTab)",
  resume_session_in_terminal: "Resume in Terminal is hidden in pop-outs (SessionDetailPanel)",
  sdk_connect: "starts the Copilot CLI; pop-outs hide the steering Connect button",
  sdk_disconnect: "the SDK store ignores disconnect outside the main window",
  sdk_cli_status: "fetched only after sdk_connect, which pop-outs cannot call",
  sdk_create_session: "the SDK store's createSession has no pop-out caller",
  sdk_detect_ui_server: "UI-server discovery lives in main-window Settings and SDK health",
  sdk_launch_ui_server: "launches a process; main-window Settings only",
  sdk_stop_ui_server: "stops a process; main-window Settings only",
};

/** Granted although no pop-out code calls it yet; see ADR 0011. */
const GRANTED_WITHOUT_CALLER: Record<string, string> = {
  close_session_window: "lets a pop-out close itself by its own label",
};

/** ADR 0011: never grant these to pop-outs without a security review. */
const DESTRUCTIVE =
  /^(save_|update_config|factory_reset|launch_|open_in_|resume_|reindex_|rebuild_|delete_|import_|export_|create_|skills_|mcp_)/;

interface Capability {
  windows: string[];
  permissions: (string | { identifier: string })[];
}

function capability(name: string): Capability {
  return JSON.parse(
    readFileSync(resolve(DESKTOP_ROOT, `src-tauri/capabilities/${name}.json`), "utf8"),
  ) as Capability;
}

const viewer = capability("viewer");
const permissionIds = viewer.permissions.map((p) => (typeof p === "string" ? p : p.identifier));
const granted = new Set(
  permissionIds
    .filter((id) => id.startsWith("tracepilot:allow-"))
    .map((id) => id.slice("tracepilot:allow-".length).replaceAll("-", "_")),
);
const registered = new Set(
  JSON.parse(
    readFileSync(
      resolve(DESKTOP_ROOT, "../../packages/client/src/generated/ipc-commands.json"),
      "utf8",
    ),
  ) as string[],
);

function describeUsers(reach: ViewerReach, cmd: string): string {
  return `${cmd} (imported by ${[...(reach.commands.get(cmd) ?? [])].join(", ")})`;
}

describe("viewer (pop-out) capabilities", () => {
  let reach: ViewerReach;
  beforeAll(() => {
    reach = analyzeViewerReach();
  });

  it("analyses pop-out code soundly", () => {
    expect(reach.errors).toEqual([]);
    // Sanity: the walk reaches the session tabs a pop-out renders.
    expect(reach.files).toEqual(
      expect.arrayContaining([
        "ChildApp.vue",
        "views/tabs/MetricsTab.vue",
        "views/tabs/ExplorerTab.vue",
      ]),
    );
    expect(reach.files).not.toContain("App.vue");
  });

  it("grants every command pop-out code can call", () => {
    const missing = [...reach.commands.keys()]
      .filter((cmd) => !granted.has(cmd) && !(cmd in MAIN_WINDOW_ONLY))
      .sort()
      .map((cmd) => describeUsers(reach, cmd));
    expect(
      missing,
      "Pop-out windows can reach these commands, but viewer.json does not grant them. " +
        "Grant read-only ones as tracepilot:allow-<command>; for writes, launches and process " +
        "control, hide the trigger in pop-outs and list the command in MAIN_WINDOW_ONLY.",
    ).toEqual([]);
  });

  it("keeps MAIN_WINDOW_ONLY current", () => {
    const stale = Object.keys(MAIN_WINDOW_ONLY).filter((cmd) => !reach.commands.has(cmd));
    expect(stale, "No longer reachable from pop-outs; remove from MAIN_WINDOW_ONLY").toEqual([]);
    const contradictory = Object.keys(MAIN_WINDOW_ONLY).filter((cmd) => granted.has(cmd));
    expect(contradictory, "Granted in viewer.json and listed as main-window-only").toEqual([]);
  });

  it("grants only registered commands that pop-out code uses", () => {
    expect([...granted].filter((cmd) => !registered.has(cmd))).toEqual([]);
    const unused = [...granted].filter(
      (cmd) => !reach.commands.has(cmd) && !(cmd in GRANTED_WITHOUT_CALLER),
    );
    expect(unused, "Granted in viewer.json but unreachable from pop-out code").toEqual([]);
  });

  it("never grants destructive commands or the blanket plugin permission", () => {
    expect([...granted].filter((cmd) => DESTRUCTIVE.test(cmd))).toEqual([]);
    expect(permissionIds).not.toContain("tracepilot:default");
    expect(viewer.windows).toEqual(["viewer-*"]);
    expect(capability("main").windows).toEqual(["main"]);
  });

  it("grants each Tauri plugin pop-out code imports and never raw invoke", () => {
    const modules = [...reach.tauriModules.keys()];
    expect(modules).not.toContain("@tauri-apps/api/core");
    const ungranted = modules
      .map((mod) => /^@tauri-apps\/plugin-(.+)$/.exec(mod)?.[1])
      .filter((plugin): plugin is string => Boolean(plugin))
      .filter((plugin) => !permissionIds.some((id) => id.startsWith(`${plugin}:`)));
    expect(ungranted, "Plugins imported by pop-out code without a viewer.json permission").toEqual(
      [],
    );
  });
});
