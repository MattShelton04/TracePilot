import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import yaml from "js-yaml";
import type { AgentInfo, EventTypeInfo, PropertyInfo, RpcMethodInfo, SchemaType } from "./types.js";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getDefinitions(root: JsonObject): JsonObject {
  const definitions = root.definitions;
  if (isJsonObject(definitions)) return definitions;
  const defs = root.$defs;
  return isJsonObject(defs) ? defs : {};
}

function resolveLocalRef(ref: string, root: JsonObject): unknown {
  const parts = ref
    .replace(/^#\//, "")
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = root;
  for (const part of parts) {
    if (!isJsonObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function resolveSchema(schema: unknown, root: JsonObject, seen = new Set<string>()): unknown {
  if (!isJsonObject(schema)) return schema;
  const ref = schema.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return schema;
  if (seen.has(ref)) return schema;
  seen.add(ref);
  return resolveSchema(resolveLocalRef(ref, root), root, seen);
}

function schemaArray(
  schema: JsonObject,
  root: JsonObject,
  keys: ("anyOf" | "oneOf" | "allOf")[],
): unknown[] {
  for (const key of keys) {
    const value = schema[key];
    if (Array.isArray(value)) return value.map((entry) => resolveSchema(entry, root));
  }
  return [];
}

function normalizeSchemaType(schema: unknown, root: JsonObject): SchemaType {
  schema = resolveSchema(schema, root);
  if (schema === null || schema === undefined) {
    return { kind: "unknown" };
  }
  const s = schema as JsonObject;

  if (s.const !== undefined) return { kind: "const", constValue: s.const };
  if (s.enum) return { kind: "enum", enumValues: s.enum as string[] };
  if (s.anyOf || s.oneOf) {
    const members = schemaArray(s, root, ["anyOf", "oneOf"]).map((member) =>
      normalizeSchemaType(member, root),
    );
    // Flatten single-member unions
    if (members.length === 1) return members[0];
    return { kind: "union", raw: members };
  }

  const type = s.type as string | string[] | undefined;
  if (Array.isArray(type)) {
    return { kind: "union", raw: type.map((t) => ({ kind: t as SchemaType["kind"] })) };
  }

  switch (type) {
    case "string":
      return { kind: "string" };
    case "number":
    case "integer":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "null":
      return { kind: "null" };
    case "array":
      return { kind: "array", items: normalizeSchemaType(s.items, root) };
    case "object": {
      const props = s.properties as Record<string, unknown> | undefined;
      const req = (s.required as string[]) ?? [];
      return {
        kind: "object",
        properties: props ? normalizeProperties(props, req, root) : [],
      };
    }
    default:
      // Object without explicit type but with properties
      if (s.properties) {
        const props = s.properties as Record<string, unknown>;
        const req = (s.required as string[]) ?? [];
        return { kind: "object", properties: normalizeProperties(props, req, root) };
      }
      return { kind: "unknown", raw: schema };
  }
}

function normalizeProperties(
  props: Record<string, unknown>,
  required: string[],
  root: JsonObject,
): PropertyInfo[] {
  return Object.entries(props).map(([name, schema]) => {
    const resolved = resolveSchema(schema, root);
    const s = resolved as Record<string, unknown> | null;
    return {
      name,
      type: normalizeSchemaType(resolved, root),
      required: required.includes(name),
      description: s?.description as string | undefined,
    };
  });
}

/**
 * Parse session-events.schema.json.
 * Schema structure: { "$ref": "#/definitions/SessionEvent", "definitions": { "SessionEvent": { "anyOf": [...] } } }
 */
export function parseSessionEventsSchema(schemaPath: string): EventTypeInfo[] {
  try {
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as JsonObject;
    const definitions = getDefinitions(schema);
    const sessionEventDef = resolveSchema(definitions.SessionEvent ?? schema, schema);
    if (!isJsonObject(sessionEventDef)) return [];
    const variants = schemaArray(sessionEventDef, schema, ["anyOf", "oneOf"]);
    if (!Array.isArray(variants)) return [];

    return variants
      .map((rawVariant): EventTypeInfo | null => {
        const variant = resolveSchema(rawVariant, schema);
        if (!isJsonObject(variant)) return null;
        const props = variant.properties as Record<string, unknown> | undefined;
        if (!props) return null;

        const typeField = resolveSchema(props.type, schema) as Record<string, unknown> | undefined;
        const eventName = typeField?.const as string | undefined;
        if (!eventName) return null;

        const dataField = resolveSchema(props.data, schema) as Record<string, unknown> | undefined;
        const dataProps = (dataField?.properties as Record<string, unknown>) ?? {};
        const dataRequired = (dataField?.required as string[]) ?? [];

        // Ephemeral classification: const: true → always, type: boolean → optional
        const ephField = resolveSchema(props.ephemeral, schema) as
          | Record<string, unknown>
          | undefined;
        let ephemeral: "always" | "optional" | "never" = "never";
        if (ephField?.const === true) ephemeral = "always";
        else if (ephField?.type === "boolean") ephemeral = "optional";

        return {
          name: eventName,
          properties: normalizeProperties(dataProps, dataRequired, schema),
          requiredFields: dataRequired,
          description: (dataField?.description as string) ?? undefined,
          ephemeral,
        };
      })
      .filter((e): e is EventTypeInfo => e !== null);
  } catch {
    return [];
  }
}

/**
 * Parse api.schema.json.
 * Schema structure: { "server": { ... nested methods ... }, "session": { ... } }
 * Methods are leaves with params/result keys.
 */
export function parseApiSchema(schemaPath: string): RpcMethodInfo[] {
  try {
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as JsonObject;
    const methods: RpcMethodInfo[] = [];

    function walk(obj: unknown, prefix: string) {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (
          key.startsWith("$") ||
          key === "title" ||
          key === "description" ||
          key === "definitions" ||
          key === "$defs"
        ) {
          continue;
        }
        const path = prefix ? `${prefix}.${key}` : key;
        const v = resolveSchema(value, schema) as Record<string, unknown>;

        // Leaf detection: has params or result
        if (v && typeof v === "object" && ("params" in v || "result" in v)) {
          const paramsObj = resolveSchema(v.params, schema) as Record<string, unknown> | null;
          const resultObj = resolveSchema(v.result, schema) as Record<string, unknown> | null;
          methods.push({
            name: path,
            params: paramsObj?.properties
              ? normalizeProperties(
                  paramsObj.properties as Record<string, unknown>,
                  (paramsObj.required as string[]) ?? [],
                  schema,
                )
              : [],
            result: resultObj?.properties
              ? normalizeProperties(
                  resultObj.properties as Record<string, unknown>,
                  (resultObj.required as string[]) ?? [],
                  schema,
                )
              : [],
            isExperimental: ((v.description as string) ?? "")
              .toLowerCase()
              .includes("experimental"),
            description: v.description as string | undefined,
          });
        } else if (v && typeof v === "object") {
          walk(v, path);
        }
      }
    }

    walk(schema, "");
    return methods;
  } catch {
    return [];
  }
}

/**
 * Parse agent definitions from definitions/*.agent.yaml files.
 */
export function parseAgentDefinitions(versionDir: string): AgentInfo[] {
  const defsDir = join(versionDir, "definitions");
  if (!existsSync(defsDir)) return [];

  try {
    return readdirSync(defsDir)
      .filter((f) => f.endsWith(".agent.yaml"))
      .map((f) => {
        const content = readFileSync(join(defsDir, f), "utf-8");
        const def = yaml.load(content) as Record<string, unknown>;
        return {
          name: (def.name as string) ?? basename(f, ".agent.yaml"),
          displayName: def.displayName as string | undefined,
          model: (def.model as string) ?? "unknown",
          toolCount: Array.isArray(def.tools) ? def.tools.length : 0,
          description: (def.description as string) ?? "",
        };
      });
  } catch {
    return [];
  }
}
