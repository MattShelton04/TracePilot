import { useAsyncGuard } from "@tracepilot/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const mockGetSessionTodos = vi.fn();
const mockGetSessionCheckpoints = vi.fn();
const mockGetSessionPlan = vi.fn();
const mockGetShutdownMetrics = vi.fn();
const mockGetSessionIncidents = vi.fn();

vi.mock("@tracepilot/client", () => ({
  getSessionTodos: (...a: unknown[]) => mockGetSessionTodos(...a),
  getSessionCheckpoints: (...a: unknown[]) => mockGetSessionCheckpoints(...a),
  getSessionPlan: (...a: unknown[]) => mockGetSessionPlan(...a),
  getShutdownMetrics: (...a: unknown[]) => mockGetShutdownMetrics(...a),
  getSessionIncidents: (...a: unknown[]) => mockGetSessionIncidents(...a),
}));

import { useSessionSections } from "@/composables/session/useSessionSections";

function setup() {
  const sessionId = ref<string | null>("sess-1");
  const loaded = ref<Set<string>>(new Set());
  const guard = useAsyncGuard();
  const sections = useSessionSections({ sessionId, loaded, guard });
  return { sessionId, loaded, guard, sections };
}

describe("useSessionSections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionTodos.mockResolvedValue({ todos: [], deps: [] });
    mockGetSessionCheckpoints.mockResolvedValue([{ number: 1, content: "cp" }]);
    mockGetSessionPlan.mockResolvedValue({ plan: "p" });
    mockGetShutdownMetrics.mockResolvedValue({ totalPremiumRequests: 1 });
    mockGetSessionIncidents.mockResolvedValue([{ severity: "warn", summary: "hi" }]);
  });

  it("loads each section into its data ref and marks it as loaded", async () => {
    const { sections, loaded } = setup();
    await sections.checkpointsDef.load();
    expect(sections.checkpointsSection.data.value).toEqual([{ number: 1, content: "cp" }]);
    expect(loaded.value.has("checkpoints")).toBe(true);
  });

  it("stores per-section error on failure", async () => {
    const { sections } = setup();
    mockGetSessionPlan.mockRejectedValue(new Error("plan failed"));
    await sections.planDef.load();
    expect(sections.planSection.error.value).toBe("plan failed");
  });

  it("clearErrors resets all section errors", async () => {
    const { sections } = setup();
    mockGetSessionTodos.mockRejectedValue(new Error("t"));
    mockGetSessionPlan.mockRejectedValue(new Error("p"));
    await sections.todosDef.load();
    await sections.planDef.load();
    expect(sections.todosSection.error.value).toBe("t");
    expect(sections.planSection.error.value).toBe("p");
    sections.clearErrors();
    expect(sections.todosSection.error.value).toBeNull();
    expect(sections.planSection.error.value).toBeNull();
  });

  it("resetData restores defaults for all sections", async () => {
    const { sections } = setup();
    await sections.checkpointsDef.load();
    await sections.incidentsDef.load();
    expect(sections.checkpointsSection.data.value).toHaveLength(1);
    sections.resetData();
    expect(sections.checkpointsSection.data.value).toEqual([]);
    expect(sections.incidentsSection.data.value).toEqual([]);
    expect(sections.todosSection.data.value).toBeNull();
  });

  it("refreshLoaded only refreshes sections present in loaded set", async () => {
    const { sections, loaded, guard } = setup();
    await sections.checkpointsDef.load();
    mockGetSessionCheckpoints.mockClear();
    mockGetSessionPlan.mockClear();

    const promises = sections.refreshLoaded("sess-1", guard.current());
    await Promise.all(promises);
    expect(mockGetSessionCheckpoints).toHaveBeenCalledTimes(1);
    expect(mockGetSessionPlan).not.toHaveBeenCalled();
    expect(loaded.value.has("plan")).toBe(false);
  });
});
