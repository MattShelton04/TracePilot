import type {
  CopilotVersion,
  EventModification,
  PropertyInfo,
  RpcModification,
  SchemaType,
  VersionDiff,
} from "./types.js";

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
