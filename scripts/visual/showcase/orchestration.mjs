// Repositories, worktrees and Copilot CLI installation for the README
// showcase. Worktrees are returned per repository, as the backend does.

import { ago, CLI_VERSION, DAY, HOUR } from "./common.mjs";
import { showcaseSessions } from "./sessions.mjs";

const root = (name) => `C:\\code\\acme\\${name}`;
const repos = [
  ["checkout-web", true, 0.02],
  ["payments-api", true, 1.6],
  ["infra", false, 5.4],
];

const sessionFor = (branch) => showcaseSessions.find((session) => session.branch === branch)?.id;

function worktree(repo, branch, { main = false, mb, status = "active", days, locked } = {}) {
  const path = main ? root(repo) : `${root(repo)}.worktrees\\${branch.replace(/\//g, "-")}`;
  const linkedSessionId = main ? undefined : sessionFor(branch);
  return {
    path,
    branch,
    headCommit: (branch.length * 2654435761).toString(16).slice(0, 7),
    isMainWorktree: main,
    isBare: false,
    diskUsageBytes: mb * 1_048_576,
    status,
    isLocked: Boolean(locked),
    ...(locked ? { lockedReason: locked } : {}),
    ...(linkedSessionId ? { linkedSessionId } : {}),
    createdAt: ago(days * DAY),
    repoRoot: root(repo),
  };
}

const worktrees = {
  [root("checkout-web")]: [
    worktree("checkout-web", "main", { main: true, mb: 612, days: 210 }),
    worktree("checkout-web", "feature/apple-pay", {
      mb: 148,
      days: 0.04,
      locked: "Copilot session running",
    }),
    worktree("checkout-web", "fix/flaky-e2e", { mb: 131, days: 0.3 }),
    worktree("checkout-web", "refactor/pinia-cart", { mb: 139, days: 2 }),
    worktree("checkout-web", "chore/codegen", { mb: 127, days: 4 }),
    worktree("checkout-web", "perf/bundle", { mb: 122, days: 31, status: "stale" }),
  ],
  [root("payments-api")]: [
    worktree("payments-api", "main", { main: true, mb: 288, days: 340 }),
    worktree("payments-api", "feat/idempotency-keys", { mb: 74, days: 0.2 }),
    worktree("payments-api", "feat/otel", { mb: 71, days: 3 }),
    worktree("payments-api", "fix/rounding", { mb: 66, days: 44, status: "stale" }),
  ],
  [root("infra")]: [
    worktree("infra", "main", { main: true, mb: 96, days: 400 }),
    worktree("infra", "chore/aws-provider-v6", { mb: 41, days: 0.4 }),
  ],
};

const version = (number, days, active) => ({
  version: number,
  path: `C:\\Users\\dev\\.copilot\\pkg\\win32-x64\\${number}`,
  isActive: active,
  isComplete: true,
  modifiedAt: ago(days * DAY),
  hasCustomizations: !active,
  lockCount: active ? 2 : 0,
});

export const showcaseOrchestration = {
  check_system_deps: () => ({
    gitAvailable: true,
    gitVersion: "2.51.0",
    copilotAvailable: true,
    copilotVersion: CLI_VERSION,
    copilotHomeExists: true,
  }),
  list_registered_repos: () =>
    repos.map(([name, favourite, hours]) => ({
      path: root(name),
      name,
      addedAt: ago(120 * DAY),
      lastUsedAt: ago(hours * HOUR),
      source: "session-discovery",
      favourite,
    })),
  list_worktrees: (args) => worktrees[args.repoPath] ?? [],
  list_branches: (args) => (worktrees[args.repoPath] ?? []).map((tree) => tree.branch),
  get_worktree_disk_usage: (args) =>
    Object.values(worktrees)
      .flat()
      .find((tree) => tree.path === args.path)?.diskUsageBytes ?? 0,
  get_available_models: () => [
    { id: "claude-opus-5.5", name: "Claude Opus 5.5", tier: "premium" },
    { id: "gpt-6-sol", name: "GPT-6 Sol", tier: "premium" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", tier: "standard" },
    { id: "gpt-6-luna", name: "GPT-6 Luna", tier: "standard" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", tier: "standard" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", tier: "fast" },
  ],
  discover_copilot_versions: () => [version(CLI_VERSION, 3, true), version("1.0.88", 19, false)],
  get_active_copilot_version: () => version(CLI_VERSION, 3, true),
  get_copilot_config: () => ({
    model: "claude-opus-5.5",
    reasoningEffort: "high",
    showReasoning: true,
    renderMarkdown: true,
    disabledSkills: [],
    trustedFolders: ["C:\\code\\acme"],
    raw: { model: "claude-opus-5.5", reasoningEffort: "high", trustedFolders: ["C:\\code\\acme"] },
    settingsPath: "C:\\Users\\dev\\.copilot\\settings.json",
  }),
  list_config_backups: () => [
    {
      id: "bk-1",
      label: "before-agent-model-overrides",
      sourcePath: "C:\\Users\\dev\\.copilot\\settings.json",
      backupPath:
        "C:\\Users\\dev\\.copilot\\tracepilot\\backups\\settings.json-before-agent-model-overrides",
      createdAt: ago(6 * DAY),
      sizeBytes: 1_284,
    },
  ],
};
