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
});
