import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  readdir: vi.fn(),
  requireSessionStateDir: vi.fn(),
  parseWorkspace: vi.fn(),
  fileExists: vi.fn(),
  streamEvents: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readdir: mocked.readdir,
}));

vi.mock("../../commands/utils.js", () => ({
  requireSessionStateDir: mocked.requireSessionStateDir,
  parseWorkspace: mocked.parseWorkspace,
  fileExists: mocked.fileExists,
  streamEvents: mocked.streamEvents,
  UUID_REGEX: /^[a-z0-9-]+$/i,
}));

import type { Dirent } from "node:fs";
import { searchSessions } from "../../commands/search.js";

function dir(name: string): Dirent {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  } as unknown as Dirent;
}

describe("commands/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.requireSessionStateDir.mockResolvedValue("/sessions");
    mocked.readdir.mockResolvedValue([dir("sess-1")]);
    mocked.parseWorkspace.mockResolvedValue({
      summary: "Assistant trimmed whitespace",
      repository: "repo/one",
      branch: "main",
    });
    mocked.fileExists.mockResolvedValue(true);
  });

  it("finds assistant messages in events", async () => {
    mocked.streamEvents.mockReturnValue(
      (async function* () {
        yield { type: "assistant.message", data: { content: "I added foo to the file" } };
      })(),
    );

    const hits = await searchSessions("foo");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      sessionId: "sess-1",
      matchSource: "assistant",
      snippet: expect.stringContaining("foo"),
    });
  });

  it("finds tool results in events", async () => {
    mocked.streamEvents.mockReturnValue(
      (async function* () {
        yield { type: "tool.result", data: { content: "Command output: bar succeeded" } };
      })(),
    );

    const hits = await searchSessions("bar");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      sessionId: "sess-1",
      matchSource: "tool",
      snippet: expect.stringContaining("bar"),
    });
  });

  it("scans multiple sessions in parallel, preserves order, parses workspace once per session, and survives per-session errors", async () => {
    mocked.readdir.mockResolvedValue([dir("sess-a"), dir("sess-b"), dir("sess-c"), dir("sess-d")]);

    // sess-a: metadata match (should NOT trigger streamEvents)
    // sess-b: parseWorkspace throws, fall through to events with assistant match
    // sess-c: workspace ok but no metadata match, events have tool match
    // sess-d: workspace ok, no metadata match, events throw — should be skipped, not abort
    mocked.parseWorkspace.mockImplementation(async (sessionDir: string) => {
      if (sessionDir.endsWith("sess-a")) {
        return { summary: "needle here", repository: "repo/a", branch: "main" };
      }
      if (sessionDir.endsWith("sess-b")) {
        throw new Error("missing workspace.yaml");
      }
      if (sessionDir.endsWith("sess-c")) {
        return { summary: "unrelated", repository: "repo/c", branch: "main" };
      }
      return { summary: "also unrelated", repository: "repo/d", branch: "main" };
    });

    mocked.streamEvents.mockImplementation((path: string) => {
      if (path.includes("sess-a")) {
        // Should never be called — metadata already matched.
        throw new Error("sess-a events should not be scanned");
      }
      if (path.includes("sess-b")) {
        return (async function* () {
          yield { type: "assistant.message", data: { content: "found needle in haystack" } };
        })();
      }
      if (path.includes("sess-c")) {
        return (async function* () {
          yield { type: "tool.result", data: { content: "needle output" } };
        })();
      }
      return (async function* () {
        throw new Error("boom");
        // biome-ignore lint/correctness/noUnreachable: unreachable yield required for generator typing
        yield {};
      })();
    });

    const hits = await searchSessions("needle");

    // sess-d errored mid-stream → no hit, but should not have aborted siblings.
    expect(hits.map((h) => h.sessionId)).toEqual(["sess-a", "sess-b", "sess-c"]);
    expect(hits[0].matchSource).toBe("metadata");
    expect(hits[1].matchSource).toBe("assistant");
    expect(hits[2].matchSource).toBe("tool");

    // Each session's workspace.yaml is parsed at most once.
    const callsPerSession = new Map<string, number>();
    for (const call of mocked.parseWorkspace.mock.calls) {
      const dirArg = call[0] as string;
      callsPerSession.set(dirArg, (callsPerSession.get(dirArg) ?? 0) + 1);
    }
    for (const [, count] of callsPerSession) {
      expect(count).toBe(1);
    }
  });
});
