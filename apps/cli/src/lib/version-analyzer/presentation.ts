import type {
  CopilotVersion,
  CoverageReport,
  EventObservation,
  SchemaType,
  SessionVersionInfo,
  VersionDiff,
} from "./types.js";
import { compareVersions } from "./version-discovery.js";

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
