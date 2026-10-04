#!/usr/bin/env node
// Generate a synthetic parser contract from an installed Copilot CLI
// `session-events.schema.json`: one event per persistable (not always
// ephemeral) type, with every optional field populated. Values are synthetic
// ("fixture", 3, true, first enum member); unions take their first non-null
// branch. Output contains no session content.
//
//   node scripts/fixtures/copilot-schema-fixture.mjs 1.0.91 \
//     crates/tracepilot-core/tests/fixtures/versions/schema_v1_0_91.jsonl
//
// Schemas are read from TRACEPILOT_COPILOT_PKG_DIR/<version>/schemas when set,
// otherwise ~/.copilot/pkg/<platform>/<version>/schemas (as `pnpm cli versions`).

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function pkgDir() {
  if (process.env.TRACEPILOT_COPILOT_PKG_DIR)
    return resolve(process.env.TRACEPILOT_COPILOT_PKG_DIR);
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const platform =
    { win32: "win32", darwin: "darwin", linux: "linux" }[process.platform] ?? "universal";
  return join(
    homedir(),
    ".copilot",
    "pkg",
    platform === "universal" ? platform : `${platform}-${arch}`,
  );
}

export function buildSchemaFixture(schema, version, timestamp) {
  const defs = schema.definitions ?? schema.$defs ?? {};
  const deref = (node) => {
    let current = node;
    for (let hops = 0; current?.$ref && hops < 50; hops++)
      current = defs[current.$ref.split("/").pop()];
    return current;
  };
  const example = (node, depth = 0) => {
    const s = deref(node);
    if (!s || depth > 14) return null;
    if (s.const !== undefined) return s.const;
    if (s.enum) return s.enum[0];
    const alternatives = s.anyOf ?? s.oneOf;
    if (alternatives) {
      const branch = alternatives.map(deref).find((b) => b && b.type !== "null");
      return branch ? example(branch, depth + 1) : null;
    }
    const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
    if (s["x-opaque-json"] && !type) return { fixture: "fixture" };
    if (type === "string") return s.format === "date-time" ? timestamp : "fixture";
    if (type === "integer" || type === "number") return 3;
    if (type === "boolean") return true;
    if (type === "array") return [example(s.items, depth + 1)];
    if (type === "object" || s.properties) {
      const out = {};
      for (const [key, value] of Object.entries(s.properties ?? {})) {
        out[key] = key === "copilotVersion" ? version : example(value, depth + 1);
      }
      if (!s.properties && s.additionalProperties && typeof s.additionalProperties === "object") {
        out.fixture = example(s.additionalProperties, depth + 1);
      }
      return out;
    }
    return "fixture";
  };

  const root = deref(schema);
  const lines = [];
  (root.anyOf ?? root.oneOf).map(deref).forEach((variant, index) => {
    const props = variant.properties;
    if (deref(props.ephemeral)?.const === true) return;
    lines.push(
      JSON.stringify({
        type: props.type.const,
        id: `fixture-${index}`,
        timestamp,
        parentId: null,
        data: example(props.data),
      }),
    );
  });
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, output, timestamp = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`] =
    process.argv.slice(2);
  if (!version || !output) {
    console.error("usage: copilot-schema-fixture.mjs <version> <output.jsonl> [timestamp]");
    process.exit(2);
  }
  const schemaPath = join(pkgDir(), version, "schemas", "session-events.schema.json");
  const fixture = buildSchemaFixture(
    JSON.parse(readFileSync(schemaPath, "utf8")),
    version,
    timestamp,
  );
  writeFileSync(output, fixture);
  console.log(`${fixture.trimEnd().split("\n").length} persisted events → ${output}`);
}
