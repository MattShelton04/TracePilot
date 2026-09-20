import type {
  AgentCatalog,
  AgentDefinitionDetail,
  AgentDefinitionSummary,
  AgentFields,
  AgentRunRecord,
  AgentUsageDetail,
  AgentUsageStats,
  AgentUsageSummary,
  AgentWriteResult,
  MetricDistribution,
  SubagentOverride,
} from "@tracepilot/types";

import {
  agentCatalog,
  agentDefinition,
  agentFields,
  agentSettings,
  agentUsage,
} from "./agentFixtures.js";

// Browser-mode fixtures for the Agents explorer. Shapes follow a real local
// corpus: built-ins from the active CLI package, one personal and one
// project agent, and usage including an agent with no definition on disk.

const DAY_MS = 86_400_000;
const PKG = "/home/dev/.copilot/pkg/linux-x64/1.0.79/definitions";

function builtin(
  name: string,
  displayName: string,
  description: string,
  model: string,
  tools: string[] | null,
): AgentDefinitionSummary {
  return agentDefinition(name, {
    id: `${PKG}/${name}.agent.yaml`,
    displayName,
    description,
    scope: "builtin",
    format: "yaml",
    path: `${PKG}/${name}.agent.yaml`,
    sourceLabel: "Copilot CLI 1.0.79",
    fields: { ...agentFields(), name, displayName, description, models: [model], tools },
    readOnlyReason:
      "Installed with the Copilot CLI. A CLI update replaces this file, so override it for your sessions instead.",
    modifiedAt: "2026-09-01T10:00:00Z",
  });
}

const REVIEWER_BODY =
  "Review the change for correctness, missing tests and risky edge cases.\n\n## Output\n\n- One finding per bullet, most severe first.\n- Cite `file:line`.";

function initialDefinitions(): AgentDefinitionSummary[] {
  return [
    builtin(
      "code-review",
      "Code Review Agent",
      "Reviews changes with a high signal-to-noise ratio. Only surfaces real issues.",
      "claude-sonnet-4.6",
      ["view", "grep", "glob", "bash"],
    ),
    builtin(
      "explore",
      "Explore Agent",
      "Fast codebase exploration and answering questions. Safe to call in parallel.",
      "claude-haiku-4.5",
      ["grep", "glob", "view", "bash", "lsp"],
    ),
    builtin(
      "research",
      "Research Agent",
      "Deep research across the codebase and the web.",
      "claude-sonnet-4.6",
      null,
    ),
    builtin(
      "rubber-duck",
      "Rubber Duck",
      "A second opinion from a complementary model.",
      "gpt-5.4",
      ["view", "grep"],
    ),
    builtin("task", "Task Agent", "Runs commands and reports results.", "claude-haiku-4.5", null),
    {
      id: "/home/dev/.copilot/agents/reviewer.agent.md",
      name: "reviewer",
      fileStem: "reviewer",
      displayName: null,
      description: "Reviews pull requests against the team's checklist.",
      scope: "personal",
      format: "markdown",
      path: "/home/dev/.copilot/agents/reviewer.agent.md",
      sourceLabel: "Personal",
      repoRoot: null,
      fields: {
        ...agentFields(),
        name: "reviewer",
        description: "Reviews pull requests against the team's checklist.",
        models: ["claude-opus-5", "gpt-5.6-luna"],
        modelPolicy: "required",
        reasoningEffort: "high",
        tools: ["view", "grep", "glob"],
        includeCustomInstructions: true,
      },
      hasMcpServers: false,
      readOnlyReason: null,
      modifiedAt: "2026-09-18T08:30:00Z",
    },
    {
      id: "/home/dev/src/tracepilot/.github/agents/docs-writer.agent.md",
      name: "docs-writer",
      fileStem: "docs-writer",
      displayName: null,
      description: "Writes and updates user-facing documentation.",
      scope: "project",
      format: "markdown",
      path: "/home/dev/src/tracepilot/.github/agents/docs-writer.agent.md",
      sourceLabel: "tracepilot",
      repoRoot: "/home/dev/src/tracepilot",
      fields: {
        ...agentFields(),
        description: "Writes and updates user-facing documentation.",
        models: ["gpt-5.4-mini"],
      },
      hasMcpServers: false,
      readOnlyReason: null,
      modifiedAt: "2026-06-01T08:30:00Z",
    },
  ];
}

const state = {
  definitions: initialDefinitions(),
  bodies: new Map<string, string>(),
  settings: agentSettings({
    settingsPath: "/home/dev/.copilot/settings.json",
    overrides: { explore: { model: "gpt-5.4-mini", effortLevel: "low", contextTier: null } },
    disabled: ["security-review"],
    maxDepth: 4,
    sessionModel: "gpt-5.6-luna",
    sessionEffort: "high",
  }),
};

function distribution(p50: number, count: number, spread = 3): MetricDistribution {
  if (!count) return { count: 0, min: null, p25: null, p50: null, p75: null, p90: null, max: null };
  return {
    count,
    min: Math.round(p50 / spread),
    p25: Math.round(p50 * 0.6),
    p50,
    p75: Math.round(p50 * 1.6),
    p90: Math.round(p50 * spread),
    max: Math.round(p50 * spread * 2),
  };
}

function stats(
  name: string,
  runs: number,
  failed: number,
  p50Ms: number,
  model: string,
  extra: Partial<AgentUsageStats> = {},
): AgentUsageStats {
  const now = Date.now();
  const dailyRuns = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(now - (29 - i) * DAY_MS).toISOString().slice(0, 10),
    runs: Math.max(0, Math.round((runs / 30) * (0.4 + ((i * 7) % 11) / 10))),
  })).filter((d) => d.runs > 0);
  return agentUsage(name, {
    runs,
    sessions: runs ? Math.max(1, Math.round(runs / 6)) : 0,
    completed: Math.max(0, runs - failed - (runs ? 1 : 0)),
    failed,
    cancelled: runs ? 1 : 0,
    durationMs: distribution(p50Ms, runs),
    totalTokens: distribution(p50Ms * 12, runs),
    toolCalls: distribution(Math.max(2, Math.round(p50Ms / 4000)), runs),
    previousMedianDurationMs: Math.round(p50Ms * 0.9),
    runsWithCredits: Math.round(runs / 3),
    ownNanoAiu: Math.round(runs * 90_000_000),
    firstUsed: runs ? new Date(now - 29 * DAY_MS).toISOString() : null,
    lastUsed: runs ? new Date(now - 2 * 3_600_000).toISOString() : null,
    topModels: runs ? [{ label: model, runs }] : [],
    runsWithConfiguration: Math.round(runs / 3),
    maxDepth: 1,
    peakSiblings: 4,
    dailyRuns,
    ...extra,
  });
}

function summary(): AgentUsageSummary {
  const agents = [
    stats("explore", 412, 3, 38_000, "gpt-5.4-mini", {
      mismatchRuns: 12,
      topModels: [
        { label: "gpt-5.4-mini", runs: 380 },
        { label: "claude-haiku-4.5", runs: 32 },
      ],
      peakSiblings: 9,
    }),
    stats("general-purpose", 318, 9, 142_000, "gpt-5.6-luna", { maxDepth: 2, followUps: 14 }),
    stats("code-review", 96, 14, 156_000, "gpt-5.6-luna", { multiTurnRuns: 20 }),
    stats("task", 44, 1, 21_000, "claude-haiku-4.5"),
    stats("rubber-duck", 12, 0, 64_000, "gpt-5.4"),
    stats("legacy-helper", 6, 2, 90_000, "claude-sonnet-4.6", {
      description: "Old in-house helper (removed)",
      lastUsed: new Date(Date.now() - 20 * DAY_MS).toISOString(),
    }),
  ];
  const total = agents.reduce((sum, a) => sum + a.runs, 0);
  return {
    totalRuns: total,
    totalSessions: 142,
    failedRuns: agents.reduce((sum, a) => sum + a.failed, 0),
    cancelledRuns: agents.length,
    incompleteRuns: 0,
    maxDepth: 2,
    peakParallelism: 9,
    runsWithCredits: agents.reduce((sum, a) => sum + a.runsWithCredits, 0),
    totalOwnNanoAiu: agents.reduce((sum, a) => sum + (a.ownNanoAiu ?? 0), 0),
    agents,
    mainAgentSelections: [],
  };
}

function detail(name: string): AgentUsageDetail {
  const found = summary().agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (!found) return { ...emptyDetail(), stats: { ...stats(name, 0, 0, 0, ""), runs: 0 } };
  const recentRuns: AgentRunRecord[] = Array.from({ length: 8 }, (_, i) => ({
    sessionId: `mock-session-${i}`,
    sessionSummary: ["Refactor auth plugins", "Fix flaky test", "Add export view"][i % 3],
    repository: "tracepilot/app",
    runKey: `call-${name}-${i}`,
    toolCallId: `call-${name}-${i}`,
    displayName: `${name} #${i + 1}`,
    description: "Investigate the change",
    startedAt: new Date(Date.now() - i * 5 * 3_600_000).toISOString(),
    outcome: i === 3 && found.failed > 0 ? "failed" : "completed",
    errorText: i === 3 && found.failed > 0 ? "Request 429: rate limited" : null,
    model: found.topModels[0]?.label ?? null,
    durationMs: 20_000 + i * 7_000,
    totalTokens: 240_000 + i * 31_000,
    totalToolCalls: 12 + i,
    ownNanoAiu: i % 2 === 0 ? 120_000_000 : null,
    depth: i === 5 ? 1 : 0,
    parentAgentName: i === 5 ? "general-purpose" : null,
    turnIndex: 0,
    eventIndex: 4,
  }));
  return {
    stats: found,
    outcomesByDay: found.dailyRuns.map((d) => ({
      date: d.date,
      completed: Math.max(0, d.runs - 1),
      failed: d.runs > 3 ? 1 : 0,
      cancelled: 0,
      incomplete: 0,
    })),
    dispatch:
      found.mismatchRuns > 0
        ? [
            {
              configuredModel: "gpt-5.4-mini",
              firstDispatchedModel: "gpt-5.4-mini",
              actualModel: "gpt-5.4-mini",
              overrideReason: null,
              runs: 120,
            },
            {
              configuredModel: "gpt-5.4-mini",
              firstDispatchedModel: "claude-haiku-4.5",
              actualModel: "claude-haiku-4.5",
              overrideReason: "model_unavailable",
              runs: found.mismatchRuns,
            },
          ]
        : [],
    invokedBy: [
      { parent: null, runs: found.runs - Math.min(20, found.runs) },
      { parent: "general-purpose", runs: Math.min(20, found.runs) },
    ],
    depths: [
      { value: 0, runs: found.runs - Math.min(20, found.runs) },
      { value: 1, runs: Math.min(20, found.runs) },
    ],
    parallelism: [
      { value: 1, runs: Math.round(found.runs / 2) },
      { value: 3, runs: Math.round(found.runs / 3) },
      { value: found.peakSiblings, runs: 8 },
    ],
    failureReasons:
      found.failed > 0
        ? [
            {
              reason: "Request #: rate limited",
              example: "Request 429: rate limited",
              runs: found.failed,
              lastSeen: new Date(Date.now() - DAY_MS).toISOString(),
            },
          ]
        : [],
    executionModes: [
      { label: "background", runs: Math.round(found.runs * 0.7) },
      { label: "sync", runs: Math.round(found.runs * 0.3) },
    ],
    repositories: [{ label: "tracepilot/app", runs: found.runs }],
    recentRuns,
  };
}

function emptyDetail(): AgentUsageDetail {
  return {
    stats: stats("", 0, 0, 0, ""),
    outcomesByDay: [],
    dispatch: [],
    invokedBy: [],
    depths: [],
    parallelism: [],
    failureReasons: [],
    executionModes: [],
    repositories: [],
    recentRuns: [],
  };
}

function definitionDetail(path: string): AgentDefinitionDetail {
  const summaryEntry = state.definitions.find((d) => d.path === path);
  if (!summaryEntry) throw new Error(`Agent definition not found: ${path}`);
  const body =
    state.bodies.get(path) ??
    (summaryEntry.format === "yaml"
      ? `You are the ${summaryEntry.name} agent. Use {{grepToolName}} and {{globToolName}} to search, then answer concisely.`
      : REVIEWER_BODY);
  const f = summaryEntry.fields;
  const rawContent =
    summaryEntry.format === "yaml"
      ? `name: ${summaryEntry.name}\ndisplayName: ${f.displayName}\ndescription: ${f.description}\nmodel: ${f.models[0]}\nprompt: |\n  ${body.split("\n").join("\n  ")}\n`
      : `---\nname: ${summaryEntry.name}\ndescription: ${f.description}\n${f.models.length ? `model: ${f.models.join(", ")}\n` : ""}---\n\n${body}\n`;
  return {
    summary: summaryEntry,
    rawContent,
    body,
    otherFields:
      summaryEntry.format === "yaml"
        ? [{ key: "promptParts", value: '{"includeAISafety":true}' }]
        : [],
    mcpServers: null,
    diagnostics: [],
  };
}

function write(path: string): AgentWriteResult {
  return { path, backupPath: `/home/dev/.copilot/tracepilot/backups/agents/${Date.now()}` };
}

/** Browser-mode fallback for the Agents explorer commands. */
export function agentsMock<T>(cmd: string, args: Record<string, unknown> = {}): T {
  const path = typeof args.path === "string" ? args.path : "";
  switch (cmd) {
    case "agents_list":
      return {
        ...agentCatalog(state.definitions, state.settings),
        personalDir: "/home/dev/.copilot/agents",
        repoRoots: ["/home/dev/src/tracepilot"],
      } satisfies AgentCatalog as T;
    case "agents_get":
      return definitionDetail(path) as T;
    case "agents_preview":
      return definitionDetail(path).rawContent as T;
    case "agents_save": {
      const entry = state.definitions.find((d) => d.path === path);
      if (entry) {
        entry.fields = args.fields as AgentFields;
        entry.description = entry.fields.description ?? "";
        state.bodies.set(path, String(args.body ?? ""));
      }
      return write(path) as T;
    }
    case "agents_save_raw":
      return write(path) as T;
    case "agents_create": {
      const name = String(args.name);
      const project = args.scope === "project";
      const created: AgentDefinitionSummary = {
        ...initialDefinitions()[5],
        name,
        fileStem: name,
        description: String(
          args.description || "Describe when Copilot should delegate to this agent.",
        ),
        scope: project ? "project" : "personal",
        sourceLabel: project ? "tracepilot" : "Personal",
        fields: { ...agentFields(), name, description: String(args.description || "") },
      };
      created.path = project
        ? `/home/dev/src/tracepilot/.github/agents/${name}.agent.md`
        : `/home/dev/.copilot/agents/${name}.agent.md`;
      created.id = created.path;
      state.definitions.push(created);
      return { path: created.path, backupPath: null } as T;
    }
    case "agents_delete":
      state.definitions = state.definitions.filter((d) => d.path !== path);
      return write(path) as T;
    case "agents_set_override": {
      const agentType = String(args.agentType);
      const value = args.value as SubagentOverride | null;
      const overrides = { ...state.settings.overrides };
      if (value && (value.model || value.effortLevel || value.contextTier)) {
        overrides[agentType] = value;
      } else {
        delete overrides[agentType];
      }
      state.settings = { ...state.settings, overrides };
      return state.settings as T;
    }
    case "agents_set_disabled": {
      const agentType = String(args.agentType);
      const disabled = state.settings.disabled.filter((n) => n !== agentType);
      if (args.disabled) disabled.push(agentType);
      state.settings = { ...state.settings, disabled };
      return state.settings as T;
    }
    case "agents_usage_summary":
      return summary() as T;
    case "agents_usage_detail":
      return detail(String(args.agentName ?? "")) as T;
    default:
      throw new Error(`No mock data for Agents command: ${cmd}`);
  }
}
