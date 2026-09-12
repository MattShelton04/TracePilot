import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diffVersions, discoverInstalledVersions } from "../../lib/version-analyzer.js";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function versions(before: object, after: object) {
  const dir = mkdtempSync(join(tmpdir(), "tracepilot-schemas-"));
  dirs.push(dir);
  for (const [version, schema] of [
    ["1.0.71", before],
    ["1.0.83", after],
  ] as const) {
    const schemas = join(dir, version, "schemas");
    mkdirSync(schemas, { recursive: true });
    writeFileSync(join(schemas, "session-events.schema.json"), JSON.stringify(schema));
  }
  vi.stubEnv("TRACEPILOT_COPILOT_PKG_DIR", dir);
  return discoverInstalledVersions();
}

function schema(payload: object, ephemeral: object = { type: "boolean" }) {
  return {
    anyOf: [
      {
        properties: {
          type: { const: "session.example" },
          ephemeral,
          data: {
            type: "object",
            properties: { payload },
          },
        },
      },
    ],
  };
}

describe("schema evolution comparisons", () => {
  it("loads archived packages separately from Copilot's rolling cache", () => {
    const found = versions(schema({ type: "string" }), schema({ type: "string" }));
    expect(found.map((v) => v.version)).toEqual(["1.0.71", "1.0.83"]);
    expect(found[0].eventTypes).toHaveLength(1);
  });

  it("detects map-value and nested required-field changes", () => {
    const object = { type: "object", properties: { count: { type: "number" } } };
    const [before, after] = versions(
      schema({ type: "object", additionalProperties: object }),
      schema({ type: "object", additionalProperties: { ...object, required: ["count"] } }),
    );
    expect(diffVersions(before, after).modifiedEvents[0].changes[0]).toContain("count?:number");
  });

  it("compares full discriminated union members and persistence", () => {
    const member = { type: "object", properties: { type: { const: "text" } } };
    const [before, after] = versions(
      schema({ anyOf: [member, { type: "null" }] }, { const: true }),
      schema({
        anyOf: [
          {
            ...member,
            properties: {
              ...member.properties,
              content: { type: "string" },
            },
          },
          { type: "null" },
        ],
      }),
    );
    const changes = diffVersions(before, after).modifiedEvents[0].changes;
    expect(changes).toHaveLength(2);
    expect(changes[0]).toContain("content?:string");
    expect(changes[1]).toBe("persistence changed (always → optional)");
  });
});
