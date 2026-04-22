import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  homedir: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  createReadStream: vi.fn(),
  createInterface: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: mocked.homedir,
}));

vi.mock("node:fs/promises", () => ({
  stat: mocked.stat,
  readdir: mocked.readdir,
  readFile: mocked.readFile,
}));

vi.mock("node:fs", () => ({
  createReadStream: mocked.createReadStream,
}));

vi.mock("node:readline", () => ({
  createInterface: mocked.createInterface,
}));

import {
  fileExists,
  findSession,
  getSessionStateDir,
  parseWorkspace,
  requireSessionStateDir,
  streamEvents,
} from "../../commands/utils.js";

function makeDirent(name: string, isDirectory: boolean) {
  return {
    name,
    isDirectory: () => isDirectory,
  };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe("commands/utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.homedir.mockReturnValue("/tmp/home");
    mocked.stat.mockResolvedValue({ isDirectory: () => true });
    mocked.readdir.mockResolvedValue([]);
    mocked.readFile.mockResolvedValue("");
    mocked.createReadStream.mockReturnValue({} as never);
    mocked.createInterface.mockReturnValue((async function* () {})());
    delete process.env.TRACEPILOT_SESSION_STATE_DIR;
    delete process.env.COPILOT_SESSION_STATE_DIR;
  });

  it("builds session state dir from homedir", () => {
    expect(getSessionStateDir()).toBe(join("/tmp/home", ".copilot", "session-state"));
  });

  it("prefers TRACEPILOT_SESSION_STATE_DIR env var and expands home", () => {
    process.env.TRACEPILOT_SESSION_STATE_DIR = "~/.tracepilot/sessions";
    expect(getSessionStateDir()).toBe(resolve(join("/tmp/home", ".tracepilot/sessions")));
  });

  it("falls back to COPILOT_SESSION_STATE_DIR when tracepilot override is unset", () => {
    process.env.COPILOT_SESSION_STATE_DIR = "/var/copilot/session-state";
    expect(getSessionStateDir()).toBe(resolve("/var/copilot/session-state"));
  });

  it("requireSessionStateDir returns path when directory exists", async () => {
    await expect(requireSessionStateDir()).resolves.toBe(
      join("/tmp/home", ".copilot", "session-state"),
    );
  });

  it("requireSessionStateDir throws a user-friendly message on ENOENT", async () => {
    mocked.stat.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    await expect(requireSessionStateDir()).rejects.toThrow(/No Copilot session data found/);
  });

  it("requireSessionStateDir throws when path exists but is not a directory", async () => {
    mocked.stat.mockResolvedValue({ isDirectory: () => false });
    await expect(requireSessionStateDir()).rejects.toThrow(/found a file instead/);
  });

  it("requireSessionStateDir includes reason for non-ENOENT errors", async () => {
    mocked.stat.mockRejectedValue(new Error("permission denied"));
    await expect(requireSessionStateDir()).rejects.toThrow(
      /Unable to read Copilot session directory.*permission denied/,
    );
  });

  it("findSession resolves unambiguous prefix match", async () => {
    mocked.readdir.mockResolvedValue([
      makeDirent("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", true),
      makeDirent("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", true),
      makeDirent("not-a-uuid", true),
      makeDirent("cccccccc-cccc-cccc-cccc-cccccccccccc", false),
    ]);

    await expect(findSession("aaaa")).resolves.toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("findSession throws when there are no valid session directories", async () => {
    mocked.readdir.mockResolvedValue([makeDirent("not-a-uuid", true)]);
    await expect(findSession("a")).rejects.toThrow(/No Copilot sessions found/);
  });

  it("findSession throws when no prefix match exists", async () => {
    mocked.readdir.mockResolvedValue([makeDirent("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", true)]);
    await expect(findSession("ffff")).rejects.toThrow(/No session matching/);
  });

  it("findSession throws when prefix is ambiguous", async () => {
    mocked.readdir.mockResolvedValue([
      makeDirent("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", true),
      makeDirent("aaaa1111-1111-1111-1111-111111111111", true),
    ]);
    await expect(findSession("aaaa")).rejects.toThrow(/Ambiguous ID/);
  });

  it("parseWorkspace maps snake_case and normalizes dates", async () => {
    mocked.readFile.mockResolvedValue(`id: sess-1
cwd: /repo
git_root: /repo
repository: owner/repo
host_type: github
branch: main
summary: hello
summary_count: 7
created_at: 2024-01-02T03:04:05.000Z
updated_at: 2024-01-02T04:05:06.000Z
`);

    await expect(parseWorkspace("/tmp/home/.copilot/session-state/sess-1")).resolves.toEqual({
      id: "sess-1",
      cwd: "/repo",
      gitRoot: "/repo",
      repository: "owner/repo",
      hostType: "github",
      branch: "main",
      summary: "hello",
      summaryCount: 7,
      createdAt: "2024-01-02T03:04:05.000Z",
      updatedAt: "2024-01-02T04:05:06.000Z",
    });
  });

  it("streamEvents yields valid JSON lines and skips invalid/blank lines", async () => {
    mocked.createInterface.mockReturnValue(
      (async function* () {
        yield "";
        yield "  ";
        yield '{"type":"user.message","data":{"content":"hi"}}';
        yield "{bad json";
        yield '{"type":"assistant.message","data":{"content":"ok"}}';
      })(),
    );

    const events = await collect(streamEvents("/tmp/events.jsonl"));
    expect(events).toEqual([
      { type: "user.message", data: { content: "hi" } },
      { type: "assistant.message", data: { content: "ok" } },
    ]);
    expect(mocked.createReadStream).toHaveBeenCalledWith("/tmp/events.jsonl");
    expect(mocked.createInterface).toHaveBeenCalledWith({
      input: expect.anything(),
    });
  });

  it("fileExists returns true when stat succeeds", async () => {
    mocked.stat.mockResolvedValue({ isDirectory: () => false });
    await expect(fileExists("/tmp/file")).resolves.toBe(true);
  });

  it("fileExists returns false when stat fails", async () => {
    mocked.stat.mockRejectedValue(new Error("missing"));
    await expect(fileExists("/tmp/missing")).resolves.toBe(false);
  });
});
