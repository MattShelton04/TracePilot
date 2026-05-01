import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverInstalledVersions,
  parseApiSchema,
  parseSessionEventsSchema,
} from "../../lib/version-analyzer.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "version-analyzer",
);
const packageDir = join(fixturesDir, "pkg", "universal", "1.0.39");

describe("version analyzer schema parsing", () => {
  it("resolves referenced session event variants and data schemas", () => {
    const events = parseSessionEventsSchema(
      join(packageDir, "schemas", "session-events.schema.json"),
    );

    expect(events).toEqual([
      {
        name: "session.start",
        properties: [
          {
            name: "copilotVersion",
            type: { kind: "string" },
            required: true,
            description: undefined,
          },
          {
            name: "turnCount",
            type: { kind: "number" },
            required: false,
            description: undefined,
          },
        ],
        requiredFields: ["copilotVersion"],
        description: "Session start payload.",
        ephemeral: "always",
      },
      {
        name: "session.heartbeat",
        properties: [
          {
            name: "latencyMs",
            type: { kind: "number" },
            required: true,
            description: undefined,
          },
        ],
        requiredFields: ["latencyMs"],
        description: undefined,
        ephemeral: "optional",
      },
    ]);
  });

  it("parses RPC methods without treating schema definitions as methods", () => {
    const methods = parseApiSchema(join(packageDir, "schemas", "api.schema.json"));

    expect(methods.map((method) => method.name)).toEqual(["server.ping", "session.abort"]);
    expect(methods[0]).toMatchObject({
      name: "server.ping",
      isExperimental: false,
      params: [{ name: "message", type: { kind: "string" }, required: true }],
      result: [{ name: "reply", type: { kind: "string" }, required: true }],
    });
    expect(methods[1]).toMatchObject({
      name: "session.abort",
      isExperimental: true,
      params: [{ name: "reason", type: { kind: "string" }, required: true }],
      result: [{ name: "ok", type: { kind: "boolean" }, required: true }],
    });
  });
});

describe("version analyzer discovery", () => {
  it("discovers fixture package versions without reading user state", () => {
    const versions = discoverInstalledVersions(join(fixturesDir, "pkg", "universal"));

    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version: "1.0.39",
      gitCommit: "abcdef123456",
      path: packageDir,
    });
    expect(versions[0].eventTypes.map((event) => event.name)).toEqual([
      "session.start",
      "session.heartbeat",
    ]);
    expect(versions[0].rpcMethods.map((method) => method.name)).toEqual([
      "server.ping",
      "session.abort",
    ]);
    expect(versions[0].agents).toEqual([
      {
        name: "task",
        displayName: "Task Agent",
        model: "claude-haiku-4.5",
        toolCount: 2,
        description: "Fixture task agent.",
      },
    ]);
  });
});
