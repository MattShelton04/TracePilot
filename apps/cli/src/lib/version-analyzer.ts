/**
 * Copilot CLI Version Analyzer
 *
 * Parses installed Copilot CLI schemas, computes diffs between versions,
 * analyzes TracePilot coverage gaps, and scans sessions for real examples.
 */

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { TRACEPILOT_KNOWN_EVENTS } from "@tracepilot/types";
import yaml from "js-yaml";

// ── Types ────────────────────────────────────────────────────────────

export interface SchemaType {
  kind:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "null"
    | "union"
    | "enum"
    | "const"
    | "unknown";
  enumValues?: string[];
  constValue?: unknown;
  items?: SchemaType;
  properties?: PropertyInfo[];
  raw?: unknown;
}

export interface PropertyInfo {
  name: string;
  type: SchemaType;
  required: boolean;
  description?: string;
}

export interface EventTypeInfo {
  name: string;
  properties: PropertyInfo[];
  requiredFields: string[];
  description?: string;
  ephemeral: "always" | "optional" | "never";
}

export interface RpcMethodInfo {
  name: string;
  params: PropertyInfo[];
  result: PropertyInfo[];
  isExperimental: boolean;
  description?: string;
}

export interface AgentInfo {
  name: string;
  displayName?: string;
  model: string;
  toolCount: number;
  description: string;
}

export interface CopilotVersion {
  version: string;
  gitCommit?: string;
  path: string;
  eventTypes: EventTypeInfo[];
  rpcMethods: RpcMethodInfo[];
  agents: AgentInfo[];
}

export interface VersionDiff {
  from: string;
  to: string;
  addedEvents: string[];
  removedEvents: string[];
  modifiedEvents: EventModification[];
  addedRpcMethods: string[];
  removedRpcMethods: string[];
  modifiedRpcMethods: RpcModification[];
  addedAgents: string[];
  removedAgents: string[];
}

export interface EventModification {
  eventType: string;
  addedProperties: string[];
  removedProperties: string[];
  changes: string[];
}

export interface RpcModification {
  method: string;
  changes: string[];
}

export interface EventObservation {
  eventType: string;
  inSchema: boolean;
  ephemeral: "always" | "optional" | "never";
  handledByTracePilot: boolean;
  observedLocally: boolean;
  exampleSessions: SessionExample[];
  category: string;
  recommendation: string;
}

export interface SessionExample {
  sessionId: string;
  copilotVersion: string;
  timestamp?: string;
  summary?: string;
}

export interface CoverageReport {
  schemaVersion: string;
  totalSchemaEvents: number;
  alwaysEphemeralCount: number;
  persistedEventCount: number;
  handledCount: number;
  unhandledPersistedCount: number;
  coveragePercentage: number;
  observations: EventObservation[];
}

export interface SessionVersionInfo {
  sessionId: string;
  copilotVersion: string;
  eventTypesObserved: Set<string>;
  createdAt?: string;
  summary?: string;
}

// ── Schema Parsing ───────────────────────────────────────────────────

function normalizeSchemaType(schema: unknown): SchemaType {
  if (schema === null || schema === undefined) {
    return { kind: "unknown" };
  }
  const s = schema as Record<string, unknown>;

  if (s.const !== undefined) return { kind: "const", constValue: s.const };
  if (s.enum) return { kind: "enum", enumValues: s.enum as string[] };
  if (s.anyOf || s.oneOf) {
    const members = ((s.anyOf ?? s.oneOf) as unknown[]).map(normalizeSchemaType);
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
      return { kind: "array", items: normalizeSchemaType(s.items) };
    case "object": {
      const props = s.properties as Record<string, unknown> | undefined;
      const req = (s.required as string[]) ?? [];
      return {
        kind: "object",
        properties: props ? normalizeProperties(props, req) : [],
      };
    }
    default:
      // Object without explicit type but with properties
      if (s.properties) {
        const props = s.properties as Record<string, unknown>;
        const req = (s.required as string[]) ?? [];
        return { kind: "object", properties: normalizeProperties(props, req) };
      }
      return { kind: "unknown", raw: schema };
  }
}

function normalizeProperties(props: Record<string, unknown>, required: string[]): PropertyInfo[] {
  return Object.entries(props).map(([name, schema]) => {
    const s = schema as Record<string, unknown> | null;
    return {
      name,
      type: normalizeSchemaType(schema),
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
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    // Resolve $ref → definitions.SessionEvent.anyOf
    const sessionEventDef = schema.definitions?.SessionEvent;
    const variants = sessionEventDef?.anyOf;
    if (!Array.isArray(variants)) return [];

    return variants
      .map((variant: Record<string, unknown>): EventTypeInfo | null => {
        const props = variant.properties as Record<string, unknown> | undefined;
        if (!props) return null;

        const typeField = props.type as Record<string, unknown> | undefined;
        const eventName = typeField?.const as string | undefined;
        if (!eventName) return null;

        const dataField = props.data as Record<string, unknown> | undefined;
        const dataProps = (dataField?.properties as Record<string, unknown>) ?? {};
        const dataRequired = (dataField?.required as string[]) ?? [];

        // Ephemeral classification: const: true → always, type: boolean → optional
        const ephField = props.ephemeral as Record<string, unknown> | undefined;
        let ephemeral: "always" | "optional" | "never" = "never";
        if (ephField?.const === true) ephemeral = "always";
        else if (ephField?.type === "boolean") ephemeral = "optional";

        return {
          name: eventName,
          properties: normalizeProperties(dataProps, dataRequired),
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
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    const methods: RpcMethodInfo[] = [];

    function walk(obj: unknown, prefix: string) {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (key.startsWith("$") || key === "title" || key === "description") continue;
        const path = prefix ? `${prefix}.${key}` : key;
        const v = value as Record<string, unknown>;

        // Leaf detection: has params or result
        if (v && ("params" in v || "result" in v)) {
          const paramsObj = v.params as Record<string, unknown> | null;
          const resultObj = v.result as Record<string, unknown> | null;
          methods.push({
            name: path,
            params: paramsObj?.properties
              ? normalizeProperties(
                  paramsObj.properties as Record<string, unknown>,
                  (paramsObj.required as string[]) ?? [],
                )
              : [],
            result: resultObj?.properties
              ? normalizeProperties(
                  resultObj.properties as Record<string, unknown>,
                  (resultObj.required as string[]) ?? [],
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

// ── Version Discovery ────────────────────────────────────────────────

function getCopilotPkgDir(): string {
  return join(homedir(), ".copilot", "pkg", "universal");
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export function discoverInstalledVersions(): CopilotVersion[] {
  const pkgDir = getCopilotPkgDir();
  if (!existsSync(pkgDir)) return [];

  const dirs = readdirSync(pkgDir).filter((d) => {
    const full = join(pkgDir, d);
    return statSync(full).isDirectory() && /^\d+\.\d+\.\d+/.test(d);
  });

  return dirs.sort(compareVersions).map((version) => {
    const versionDir = join(pkgDir, version);
    const eventsSchemaPath = join(versionDir, "schemas", "session-events.schema.json");
    const apiSchemaPath = join(versionDir, "schemas", "api.schema.json");

    // Try to get git commit from package.json
    let gitCommit: string | undefined;
    const pkgJsonPath = join(versionDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        gitCommit = pkg.gitHead ?? pkg.gitCommit;
      } catch {
        /* ignore */
      }
    }

    return {
      version,
      gitCommit,
      path: versionDir,
      eventTypes: existsSync(eventsSchemaPath) ? parseSessionEventsSchema(eventsSchemaPath) : [],
      rpcMethods: existsSync(apiSchemaPath) ? parseApiSchema(apiSchemaPath) : [],
      agents: parseAgentDefinitions(versionDir),
    };
  });
}

// ── Diffing ──────────────────────────────────────────────────────────

function categorizeEvent(name: string): string {
  const prefix = name.split(".")[0];
  const mapping: Record<string, string> = {
    session: "Session",
    user: "User",
    assistant: "Assistant",
    tool: "Tool",
    subagent: "Subagent",
    system: "System",
    skill: "Skill",
    hook: "Hook",
    permission: "Permission",
    elicitation: "Input",
    user_input: "Input",
    external_tool: "External",
    command: "Command",
    exit_plan_mode: "Plan",
    pending_messages: "User",
    abort: "Control",
  };
  return mapping[prefix] ?? mapping[name] ?? "Other";
}

/** Serialize a SchemaType to a canonical string for structural comparison. */
function schemaTypeFingerprint(st: SchemaType): string {
  switch (st.kind) {
    case "enum":
      return `enum(${(st.enumValues ?? []).sort().join(",")})`;
    case "const":
      return `const(${JSON.stringify(st.constValue)})`;
    case "array":
      return `array<${st.items ? schemaTypeFingerprint(st.items) : "unknown"}>`;
    case "object": {
      const props = (st.properties ?? [])
        .map((p) => `${p.name}:${schemaTypeFingerprint(p.type)}`)
        .sort()
        .join(";");
      return `object{${props}}`;
    }
    case "union": {
      // Summarize union members by extracting type discriminators where possible
      if (Array.isArray(st.raw)) {
        const members = (st.raw as SchemaType[]).map((m) => {
          if (m.kind === "object" && m.properties) {
            const typeConst = m.properties.find(
              (p) => p.name === "type" && p.type.kind === "const",
            );
            if (typeConst) return String(typeConst.type.constValue);
          }
          return schemaTypeFingerprint(m);
        });
        return `union(${members.sort().join("|")})`;
      }
      return `union(${JSON.stringify(st.raw)})`;
    }
    default:
      return st.kind;
  }
}

function diffProperties(
  p1List: PropertyInfo[],
  p2List: PropertyInfo[],
  prefix: string,
): { added: string[]; removed: string[]; changes: string[] } {
  const p1Names = new Set(p1List.map((p) => p.name));
  const p2Names = new Set(p2List.map((p) => p.name));
  const added = [...p2Names].filter((p) => !p1Names.has(p));
  const removed = [...p1Names].filter((p) => !p2Names.has(p));
  const changes: string[] = [];

  for (const name of [...p2Names].filter((p) => p1Names.has(p))) {
    const prop1 = p1List.find((p) => p.name === name);
    const prop2 = p2List.find((p) => p.name === name);
    if (!prop1 || !prop2) continue;

    const fp1 = schemaTypeFingerprint(prop1.type);
    const fp2 = schemaTypeFingerprint(prop2.type);
    if (fp1 !== fp2) {
      changes.push(`${prefix}${name}: type changed (${fp1} → ${fp2})`);
    }
    if (prop1.required !== prop2.required) {
      changes.push(`${prefix}${name}: ${prop2.required ? "now required" : "no longer required"}`);
    }
  }

  return { added, removed, changes };
}

export function diffVersions(v1: CopilotVersion, v2: CopilotVersion): VersionDiff {
  const v1Events = new Set(v1.eventTypes.map((e) => e.name));
  const v2Events = new Set(v2.eventTypes.map((e) => e.name));
  const v1Methods = new Set(v1.rpcMethods.map((m) => m.name));
  const v2Methods = new Set(v2.rpcMethods.map((m) => m.name));
  const v1Agents = new Set(v1.agents.map((a) => a.name));
  const v2Agents = new Set(v2.agents.map((a) => a.name));

  const addedEvents = [...v2Events].filter((e) => !v1Events.has(e));
  const removedEvents = [...v1Events].filter((e) => !v2Events.has(e));

  // Detect modified events (same name, different properties)
  const modifiedEvents: EventModification[] = [];
  const commonEvents = [...v2Events].filter((e) => v1Events.has(e));
  for (const eventName of commonEvents) {
    const e1 = v1.eventTypes.find((e) => e.name === eventName);
    const e2 = v2.eventTypes.find((e) => e.name === eventName);
    if (!e1 || !e2) continue;

    const { added, removed, changes } = diffProperties(e1.properties, e2.properties, "");

    if (added.length > 0 || removed.length > 0 || changes.length > 0) {
      modifiedEvents.push({
        eventType: eventName,
        addedProperties: added,
        removedProperties: removed,
        changes,
      });
    }
  }

  // RPC method modifications (detect added, removed, and changed params/results)
  const addedRpcMethods = [...v2Methods].filter((m) => !v1Methods.has(m));
  const removedRpcMethods = [...v1Methods].filter((m) => !v2Methods.has(m));
  const modifiedRpcMethods: RpcModification[] = [];
  const commonMethods = [...v2Methods].filter((m) => v1Methods.has(m));
  for (const methodName of commonMethods) {
    const m1 = v1.rpcMethods.find((m) => m.name === methodName);
    const m2 = v2.rpcMethods.find((m) => m.name === methodName);
    if (!m1 || !m2) continue;

    const paramsDiff = diffProperties(m1.params, m2.params, "params.");
    const resultDiff = diffProperties(m1.result, m2.result, "result.");

    const changes: string[] = [];
    if (paramsDiff.added.length) changes.push(`+params: ${paramsDiff.added.join(", ")}`);
    if (paramsDiff.removed.length) changes.push(`-params: ${paramsDiff.removed.join(", ")}`);
    if (resultDiff.added.length) changes.push(`+result: ${resultDiff.added.join(", ")}`);
    if (resultDiff.removed.length) changes.push(`-result: ${resultDiff.removed.join(", ")}`);
    changes.push(...paramsDiff.changes, ...resultDiff.changes);

    if (changes.length > 0) {
      modifiedRpcMethods.push({ method: methodName, changes });
    }
  }

  return {
    from: v1.version,
    to: v2.version,
    addedEvents,
    removedEvents,
    modifiedEvents,
    addedRpcMethods,
    removedRpcMethods,
    modifiedRpcMethods,
    addedAgents: [...v2Agents].filter((a) => !v1Agents.has(a)),
    removedAgents: [...v1Agents].filter((a) => !v2Agents.has(a)),
  };
}

export function diffAllVersions(versions: CopilotVersion[]): VersionDiff[] {
  const diffs: VersionDiff[] = [];
  for (let i = 1; i < versions.length; i++) {
    diffs.push(diffVersions(versions[i - 1], versions[i]));
  }
  return diffs;
}

// ── Coverage Analysis ────────────────────────────────────────────────

export function computeCoverage(
  latestVersion: CopilotVersion,
  sessionInfo?: SessionVersionInfo[],
): CoverageReport {
  const knownSet = new Set(TRACEPILOT_KNOWN_EVENTS as readonly string[]);

  // Collect all observed event types across sessions
  const observedTypes = new Set<string>();
  const examplesByType = new Map<string, SessionExample[]>();
  if (sessionInfo) {
    for (const session of sessionInfo) {
      for (const et of session.eventTypesObserved) {
        observedTypes.add(et);
        if (!examplesByType.has(et)) examplesByType.set(et, []);
        // Safe: we just set the value above if it didn't exist
        const examples = examplesByType.get(et) ?? [];
        if (examples.length < 3) {
          examples.push({
            sessionId: session.sessionId,
            copilotVersion: session.copilotVersion,
            timestamp: session.createdAt,
            summary: session.summary,
          });
        }
      }
    }
  }

  const alwaysEphemeral = latestVersion.eventTypes.filter((e) => e.ephemeral === "always");
  const persistedEvents = latestVersion.eventTypes.filter((e) => e.ephemeral !== "always");
  const handled = persistedEvents.filter((e) => knownSet.has(e.name));
  const unhandled = persistedEvents.filter((e) => !knownSet.has(e.name));

  const observations: EventObservation[] = latestVersion.eventTypes.map((et) => {
    const isHandled = knownSet.has(et.name);
    const isObserved = observedTypes.has(et.name);
    const examples = examplesByType.get(et.name) ?? [];
    const category = categorizeEvent(et.name);

    let recommendation: string;
    if (isHandled) {
      recommendation = "✅ Already handled";
    } else if (et.ephemeral === "always") {
      recommendation = "👻 Always ephemeral — never stored in events.jsonl, no action needed";
    } else if (isObserved) {
      recommendation = "⚠️ Observed in sessions but not handled — consider adding typed support";
    } else {
      recommendation = "ℹ️ Defined in schema but not yet observed locally — monitor";
    }

    return {
      eventType: et.name,
      inSchema: true,
      ephemeral: et.ephemeral,
      handledByTracePilot: isHandled,
      observedLocally: isObserved,
      exampleSessions: examples,
      category,
      recommendation,
    };
  });

  const coveragePct =
    persistedEvents.length > 0
      ? Math.round((handled.length / persistedEvents.length) * 1000) / 10
      : 100;

  return {
    schemaVersion: latestVersion.version,
    totalSchemaEvents: latestVersion.eventTypes.length,
    alwaysEphemeralCount: alwaysEphemeral.length,
    persistedEventCount: persistedEvents.length,
    handledCount: handled.length,
    unhandledPersistedCount: unhandled.length,
    coveragePercentage: coveragePct,
    observations,
  };
}

// ── Session Scanning ─────────────────────────────────────────────────

function getSessionStateDir(): string {
  return join(homedir(), ".copilot", "session-state");
}

/**
 * Scan sessions to extract copilotVersion and observed event types.
 * Reads all events in each session for complete coverage data.
 */
export async function scanSessionVersions(maxSessions = 10000): Promise<SessionVersionInfo[]> {
  const sessionsDir = getSessionStateDir();
  if (!existsSync(sessionsDir)) return [];

  const sessionDirs = readdirSync(sessionsDir).filter((d) => {
    return /^[0-9a-f]{8}-/.test(d) && statSync(join(sessionsDir, d)).isDirectory();
  });

  const results: SessionVersionInfo[] = [];

  for (const dir of sessionDirs) {
    if (results.length >= maxSessions) break;

    const sessionPath = join(sessionsDir, dir);
    const eventsPath = join(sessionPath, "events.jsonl");
    if (!existsSync(eventsPath)) continue;

    let copilotVersion = "unknown";
    const eventTypesObserved = new Set<string>();

    // Stream events — use lightweight regex extraction for type field to avoid
    // full JSON parsing of large events (e.g. session.import_legacy).
    // Only do full JSON parse for session.start/session.resume to get copilotVersion.
    const typeRe = /"type"\s*:\s*"([^"]+)"/;
    try {
      const rl = createInterface({ input: createReadStream(eventsPath) });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const typeMatch = typeRe.exec(trimmed);
        if (!typeMatch) continue;
        const eventType = typeMatch[1];
        eventTypesObserved.add(eventType);

        // Full parse only for session.start/resume to extract copilotVersion
        if (
          eventType === "session.start" ||
          (eventType === "session.resume" && copilotVersion === "unknown")
        ) {
          try {
            const event = JSON.parse(trimmed) as Record<string, unknown>;
            const data = event.data as Record<string, unknown> | undefined;
            if (data?.copilotVersion) {
              copilotVersion = String(data.copilotVersion);
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch {
      /* skip unreadable files */
    }

    if (eventTypesObserved.size > 0) {
      // Defer workspace.yaml read until we know this session has useful data
      let summary: string | undefined;
      let createdAt: string | undefined;
      const workspacePath = join(sessionPath, "workspace.yaml");
      if (existsSync(workspacePath)) {
        try {
          const ws = yaml.load(readFileSync(workspacePath, "utf-8")) as Record<string, unknown>;
          summary = ws.summary as string | undefined;
          const ca = ws.created_at;
          createdAt = ca instanceof Date ? ca.toISOString() : (ca as string);
        } catch {
          /* ignore */
        }
      }

      results.push({
        sessionId: dir,
        copilotVersion,
        eventTypesObserved,
        createdAt,
        summary,
      });
    }
  }

  return results;
}

/**
 * Find sessions containing a specific event type.
 * Scans up to maxSessionsScanned sessions, returns up to maxResults matches.
 */
export async function findEventExamples(
  eventType: string,
  maxResults = 10,
  maxSessionsScanned = 10000,
): Promise<SessionExample[]> {
  const sessionsDir = getSessionStateDir();
  if (!existsSync(sessionsDir)) return [];

  const sessionDirs = readdirSync(sessionsDir).filter((d) => /^[0-9a-f]{8}-/.test(d));

  const results: SessionExample[] = [];
  let sessionsChecked = 0;

  for (const dir of sessionDirs) {
    if (results.length >= maxResults || sessionsChecked >= maxSessionsScanned) break;

    const eventsPath = join(sessionsDir, dir, "events.jsonl");
    if (!existsSync(eventsPath)) continue;
    sessionsChecked++;

    let found = false;
    let copilotVersion = "unknown";

    try {
      const rl = createInterface({ input: createReadStream(eventsPath) });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          const et = event.type as string;
          if (et === "session.start") {
            const data = event.data as Record<string, unknown> | undefined;
            if (data?.copilotVersion) copilotVersion = String(data.copilotVersion);
          }
          if (et === eventType) {
            found = true;
            rl.close();
            break;
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }

    if (found) {
      // Get summary from workspace.yaml
      let summary: string | undefined;
      const workspacePath = join(sessionsDir, dir, "workspace.yaml");
      if (existsSync(workspacePath)) {
        try {
          const ws = yaml.load(readFileSync(workspacePath, "utf-8")) as Record<string, unknown>;
          summary = ws.summary as string | undefined;
        } catch {
          /* ignore */
        }
      }

      results.push({
        sessionId: dir,
        copilotVersion,
        summary,
      });
    }
  }

  return results;
}

// ── Report Generation ────────────────────────────────────────────────

function _schemaTypeToString(st: SchemaType): string {
  switch (st.kind) {
    case "enum":
      return st.enumValues ? st.enumValues.map((v) => `"${v}"`).join(" | ") : "enum";
    case "union":
      return "union";
    case "array":
      return `${st.items ? _schemaTypeToString(st.items) : "unknown"}[]`;
    case "object":
      return "object";
    case "const":
      return JSON.stringify(st.constValue);
    default:
      return st.kind;
  }
}

export function generateMarkdownReport(
  versions: CopilotVersion[],
  diffs: VersionDiff[],
  coverage: CoverageReport,
  sessionInfo: SessionVersionInfo[],
): string {
  const lines: string[] = [];

  lines.push("# Copilot CLI Version Analysis Report");
  lines.push("");
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Versions analyzed: ${versions.map((v) => v.version).join(", ")}`);
  lines.push(`> Sessions scanned: ${sessionInfo.length}`);
  lines.push("");

  // ── Executive Summary
  lines.push("## 1. Executive Summary");
  lines.push("");
  lines.push(
    `TracePilot has **${versions.length} installed Copilot CLI versions** spanning from v${versions[0]?.version} to v${versions[versions.length - 1]?.version}.`,
  );
  lines.push("");
  lines.push(
    `**Coverage:** TracePilot handles **${coverage.handledCount}/${coverage.persistedEventCount}** persisted event types (**${coverage.coveragePercentage}%**). An additional ${coverage.alwaysEphemeralCount} event types are always-ephemeral (never written to disk) and don't need handling.`,
  );
  lines.push("");
  if (coverage.unhandledPersistedCount > 0) {
    lines.push(
      `**Gap:** ${coverage.unhandledPersistedCount} persisted event types are defined in the schema but not yet handled by TracePilot.`,
    );
    lines.push("");
  }
  const uniqueVersions = new Set(sessionInfo.map((s) => s.copilotVersion));
  lines.push(
    `**Session corpus:** ${sessionInfo.length} sessions across ${uniqueVersions.size} distinct CLI versions.`,
  );
  lines.push("");

  // ── Installed Versions Table
  lines.push("## 2. Installed Versions");
  lines.push("");
  lines.push("| Version | Event Types | RPC Methods | Agents |");
  lines.push("|---------|------------|-------------|--------|");
  for (const v of versions) {
    lines.push(
      `| ${v.version} | ${v.eventTypes.length} | ${v.rpcMethods.length} | ${v.agents.length} |`,
    );
  }
  lines.push("");

  // ── Schema Evolution
  lines.push("## 3. Schema Evolution Timeline");
  lines.push("");
  for (const diff of diffs) {
    const totalChanges =
      diff.addedEvents.length +
      diff.removedEvents.length +
      diff.modifiedEvents.length +
      diff.addedRpcMethods.length +
      diff.removedRpcMethods.length +
      diff.modifiedRpcMethods.length +
      diff.addedAgents.length +
      diff.removedAgents.length;
    lines.push(`### ${diff.from} → ${diff.to} (${totalChanges} changes)`);
    lines.push("");

    if (diff.addedEvents.length > 0) {
      lines.push(`**+${diff.addedEvents.length} new event types:**`);
      for (const e of diff.addedEvents) {
        lines.push(`- \`${e}\``);
      }
      lines.push("");
    }
    if (diff.removedEvents.length > 0) {
      lines.push(`**-${diff.removedEvents.length} removed event types:**`);
      for (const e of diff.removedEvents) {
        lines.push(`- \`${e}\``);
      }
      lines.push("");
    }
    if (diff.modifiedEvents.length > 0) {
      lines.push(`**${diff.modifiedEvents.length} modified events:**`);
      for (const m of diff.modifiedEvents) {
        lines.push(`- \`${m.eventType}\``);
        for (const p of m.addedProperties) lines.push(`  - +\`${p}\``);
        for (const p of m.removedProperties) lines.push(`  - -\`${p}\``);
        for (const c of m.changes) lines.push(`  - ${c}`);
      }
      lines.push("");
    }
    if (diff.addedRpcMethods.length > 0) {
      lines.push(`**+${diff.addedRpcMethods.length} new RPC methods:**`);
      for (const m of diff.addedRpcMethods) lines.push(`- \`${m}\``);
      lines.push("");
    }
    if (diff.removedRpcMethods.length > 0) {
      lines.push(`**-${diff.removedRpcMethods.length} removed RPC methods:**`);
      for (const m of diff.removedRpcMethods) lines.push(`- \`${m}\``);
      lines.push("");
    }
    if (diff.modifiedRpcMethods.length > 0) {
      lines.push(`**${diff.modifiedRpcMethods.length} modified RPC methods:**`);
      for (const m of diff.modifiedRpcMethods) {
        lines.push(`- \`${m.method}\`: ${m.changes.join("; ")}`);
      }
      lines.push("");
    }
    if (diff.addedAgents.length > 0) {
      lines.push(
        `**+${diff.addedAgents.length} new agents:** ${diff.addedAgents.map((a) => `\`${a}\``).join(", ")}`,
      );
      lines.push("");
    }
  }

  // ── Coverage Gap Analysis
  lines.push("## 4. Coverage Gap Analysis");
  lines.push("");
  lines.push(`Based on schema v${coverage.schemaVersion}:`);
  lines.push("");

  // Group by category
  const byCategory = new Map<string, EventObservation[]>();
  for (const obs of coverage.observations) {
    const cat = obs.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)?.push(obs);
  }

  for (const [category, events] of byCategory) {
    lines.push(`### ${category}`);
    lines.push("");
    lines.push("| Event Type | Status | Ephemeral | Observed | Examples |");
    lines.push("|-----------|--------|-----------|----------|----------|");
    for (const obs of events) {
      const status = obs.handledByTracePilot
        ? "✅ Handled"
        : obs.ephemeral === "always"
          ? "👻 Ephemeral"
          : obs.observedLocally
            ? "⚠️ Gap"
            : "ℹ️ Not seen";
      const eph =
        obs.ephemeral === "always" ? "Always" : obs.ephemeral === "optional" ? "Optional" : "No";
      const observed = obs.observedLocally ? "Yes" : "No";
      const examples =
        obs.exampleSessions.length > 0
          ? obs.exampleSessions.map((e) => `${e.sessionId.slice(0, 8)}…`).join(", ")
          : "—";
      lines.push(`| \`${obs.eventType}\` | ${status} | ${eph} | ${observed} | ${examples} |`);
    }
    lines.push("");
  }

  // ── Session Examples by Version
  lines.push("## 5. Sessions by Copilot Version");
  lines.push("");
  const byVersion = new Map<string, SessionVersionInfo[]>();
  for (const s of sessionInfo) {
    if (!byVersion.has(s.copilotVersion)) byVersion.set(s.copilotVersion, []);
    byVersion.get(s.copilotVersion)?.push(s);
  }
  const sortedVersions = [...byVersion.keys()].sort(compareVersions);
  lines.push("| CLI Version | Sessions | Unique Event Types | Example Session |");
  lines.push("|------------|----------|-------------------|-----------------|");
  for (const v of sortedVersions) {
    // Safe: sortedVersions is derived from byVersion.keys()
    const sessions = byVersion.get(v) ?? [];
    const allTypes = new Set<string>();
    for (const s of sessions) {
      for (const t of s.eventTypesObserved) allTypes.add(t);
    }
    const example = sessions[0];
    const summary = example?.summary ? example.summary.slice(0, 40) : "—";
    lines.push(
      `| ${v} | ${sessions.length} | ${allTypes.size} | ${example?.sessionId.slice(0, 8)}… — ${summary} |`,
    );
  }
  lines.push("");

  // ── RPC Method Evolution
  lines.push("## 6. RPC Method Evolution");
  lines.push("");
  lines.push("| Version | Methods | Experimental |");
  lines.push("|---------|---------|-------------|");
  for (const v of versions) {
    const experimental = v.rpcMethods.filter((m) => m.isExperimental).length;
    lines.push(`| ${v.version} | ${v.rpcMethods.length} | ${experimental} |`);
  }
  lines.push("");

  if (versions.length > 0) {
    const latest = versions[versions.length - 1];
    lines.push("### All RPC Methods (latest version)");
    lines.push("");
    for (const m of latest.rpcMethods) {
      const exp = m.isExperimental ? " *(experimental)*" : "";
      const params = m.params.map((p) => p.name).join(", ");
      lines.push(`- \`${m.name}\`${exp} — params: (${params || "none"})`);
    }
    lines.push("");
  }

  // ── Agent Definitions
  lines.push("## 7. Agent Definition Changes");
  lines.push("");
  lines.push("| Version | Agents |");
  lines.push("|---------|--------|");
  for (const v of versions) {
    const names = v.agents.map((a) => `\`${a.name}\``).join(", ");
    lines.push(`| ${v.version} | ${names || "none"} |`);
  }
  lines.push("");

  if (versions.length > 0) {
    const latest = versions[versions.length - 1];
    lines.push("### Agent Details (latest version)");
    lines.push("");
    for (const a of latest.agents) {
      lines.push(`#### ${a.displayName ?? a.name}`);
      lines.push(`- **Model:** ${a.model}`);
      lines.push(`- **Tools:** ${a.toolCount}`);
      lines.push(
        `- **Description:** ${a.description.slice(0, 2000)}${a.description.length > 2000 ? "…" : ""}`,
      );
      lines.push("");
    }
  }

  // ── Forward Compatibility Assessment
  lines.push("## 8. Forward Compatibility Assessment");
  lines.push("");
  lines.push("### Strengths");
  lines.push(
    "- `Unknown(String)` catch-all variant in `SessionEventType` gracefully handles new event types",
  );
  lines.push("- All data struct fields use `Option<T>` for missing-field tolerance");
  lines.push("- `ParseDiagnostics` tracks unknown events and deserialization failures");
  lines.push("- Unknown events don't reduce session health scores (Info severity, 0.0 deduction)");
  lines.push("- Event envelope (`id`, `timestamp`, `parentId`, `type`, `data`) has never changed");
  lines.push("");
  lines.push("### Risks");
  lines.push("- ~4 releases/week with potential schema changes");
  lines.push("- No formal deprecation process from GitHub");
  lines.push(
    "- `session.start.data.version` field is always `1` (unreliable for version detection)",
  );
  lines.push("- `additionalProperties: false` in schema means strict validation would break");
  lines.push("");

  // ── Recommendations
  lines.push("## 9. Recommendations");
  lines.push("");

  const observedGaps = coverage.observations.filter(
    (o) => !o.handledByTracePilot && o.observedLocally && o.ephemeral !== "always",
  );
  if (observedGaps.length > 0) {
    lines.push("### Priority: Add typed support for observed-but-unhandled events");
    lines.push("");
    lines.push("These events appear in your local sessions but TracePilot doesn't parse them:");
    lines.push("");
    for (const g of observedGaps) {
      lines.push(`- \`${g.eventType}\` — observed in ${g.exampleSessions.length} session(s)`);
    }
    lines.push("");
  }

  const unobservedGaps = coverage.observations.filter(
    (o) => !o.handledByTracePilot && !o.observedLocally && o.ephemeral !== "always",
  );
  if (unobservedGaps.length > 0) {
    lines.push("### Monitor: Schema-defined but not yet observed locally");
    lines.push("");
    lines.push("These events exist in the schema but haven't appeared in local sessions yet.");
    lines.push("They may appear in future sessions — consider adding support proactively:");
    lines.push("");
    for (const g of unobservedGaps) {
      lines.push(`- \`${g.eventType}\``);
    }
    lines.push("");
  }

  lines.push("### Suggested next steps");
  lines.push("");
  lines.push(
    "1. **Expand `SessionEventType` enum** to cover all schema-defined event types (reduces `Unknown` noise in diagnostics)",
  );
  lines.push(
    "2. **Add `copilot_version` to index DB** for version-aware filtering in the desktop app",
  );
  lines.push(
    "3. **Add typed data structs** for high-value observed events (e.g., `assistant.usage` for per-turn token tracking)",
  );
  lines.push("4. **Run this analysis periodically** when new Copilot CLI versions are installed");
  lines.push("5. **Consider automated schema diffing** in CI to catch breaking changes early");
  lines.push("");

  return lines.join("\n");
}
