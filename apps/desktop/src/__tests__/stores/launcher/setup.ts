import { setupPinia } from "@tracepilot/test-utils";
import type { ModelInfo, SessionTemplate, SystemDependencies } from "@tracepilot/types";
import { beforeEach, vi } from "vitest";

const hoistedMocks = vi.hoisted(() => ({
  launchSession: vi.fn(),
  getAvailableModels: vi.fn(),
  listSessionTemplates: vi.fn(),
  saveSessionTemplate: vi.fn(),
  deleteSessionTemplate: vi.fn(),
  restoreDefaultTemplates: vi.fn(),
  incrementTemplateUsage: vi.fn(),
  checkSystemDeps: vi.fn(),
  logWarn: vi.fn(),
}));

export const mocks = hoistedMocks;

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    launchSession: (...args: unknown[]) => hoistedMocks.launchSession(...args),
    getAvailableModels: (...args: unknown[]) => hoistedMocks.getAvailableModels(...args),
    listSessionTemplates: (...args: unknown[]) => hoistedMocks.listSessionTemplates(...args),
    saveSessionTemplate: (...args: unknown[]) => hoistedMocks.saveSessionTemplate(...args),
    deleteSessionTemplate: (...args: unknown[]) => hoistedMocks.deleteSessionTemplate(...args),
    restoreDefaultTemplates: (...args: unknown[]) => hoistedMocks.restoreDefaultTemplates(...args),
    incrementTemplateUsage: (...args: unknown[]) => hoistedMocks.incrementTemplateUsage(...args),
    checkSystemDeps: (...args: unknown[]) => hoistedMocks.checkSystemDeps(...args),
  });
});

vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => hoistedMocks.logWarn(...args),
}));

export const MOCK_TEMPLATE: SessionTemplate = {
  id: "default-multi-agent-review",
  name: "Multi Agent Code Review",
  description: "Comprehensive code review using multiple AI models",
  icon: "🔍",
  category: "Quality",
  config: {
    repoPath: "",
    headless: false,
    envVars: {},
    createWorktree: false,
    autoApprove: false,
    model: "claude-opus-4.6",
    reasoningEffort: "high",
    prompt:
      "Spin up opus 4.6, GPT 5.4, Codex 5.3, and Gemini subagents to do a comprehensive code review of the changes on this branch (git diff). Consolidate and validate their feedback, and provide a summary.",
  },
  tags: ["review", "multi-agent", "premium"],
  createdAt: "2025-01-01T00:00:00Z",
  usageCount: 0,
};

export const MOCK_TEMPLATE_WRITE_TESTS: SessionTemplate = {
  id: "default-write-tests",
  name: "Write Tests",
  description: "Generate comprehensive test coverage for recent changes",
  icon: "🧪",
  category: "Quality",
  config: {
    repoPath: "",
    headless: false,
    envVars: {},
    createWorktree: false,
    autoApprove: false,
    model: "claude-sonnet-4.6",
    reasoningEffort: "high",
  },
  tags: ["testing", "coverage"],
  createdAt: "2025-01-01T00:00:00Z",
  usageCount: 0,
};

export const MOCK_MODELS: ModelInfo[] = [
  { id: "claude-opus-4.6", name: "Claude Opus 4.6", tier: "premium" },
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", tier: "standard" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", tier: "fast" },
];

export const MOCK_DEPS: SystemDependencies = {
  gitAvailable: true,
  gitVersion: "2.45.0",
  copilotAvailable: true,
  copilotVersion: "1.0.9",
  copilotHomeExists: true,
};

beforeEach(() => {
  setupPinia();
  for (const mock of Object.values(hoistedMocks)) mock.mockReset();
});
