import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { useToastStore } from "@/stores/toast";

const getSessionDetail = vi.fn();
const getSessionTurns = vi.fn();
const getSessionEvents = vi.fn();

vi.mock("@tracepilot/client", () => ({
  getSessionDetail: (...args: unknown[]) => getSessionDetail(...args),
  getSessionTurns: (...args: unknown[]) => getSessionTurns(...args),
  checkSessionFreshness: vi.fn(),
  getSessionEvents: (...args: unknown[]) => getSessionEvents(...args),
  getSessionTodos: vi.fn(),
  getSessionCheckpoints: vi.fn(),
  getSessionPlan: vi.fn(),
  getShutdownMetrics: vi.fn(),
  getSessionIncidents: vi.fn(),
}));

function toastMessages() {
  const toastStore = useToastStore();
  const stack = Array.isArray(toastStore.toasts)
    ? toastStore.toasts
    : toastStore.toasts.value;
  return stack.map((t) => t.message);
}

describe("sessionDetail store error notifications", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    getSessionDetail.mockReset();
    getSessionTurns.mockReset();
    getSessionEvents.mockReset();
    useToastStore().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces toast when turn loading fails", async () => {
    getSessionTurns.mockRejectedValue(new Error("turns down"));
    const store = useSessionDetailStore();
    store.sessionId = "session-1";

    await store.loadTurns();

    const messages = toastMessages();
    expect(messages.some((m) => m.toLowerCase().includes("turn"))).toBe(true);
  });

  it("throttles repeated events errors", async () => {
    getSessionEvents.mockRejectedValue(new Error("events unavailable"));
    const store = useSessionDetailStore();
    store.sessionId = "session-2";

    await store.loadEvents();
    await store.loadEvents();
    expect(toastMessages()).toHaveLength(1);

    vi.setSystemTime(new Date("2024-01-01T00:00:06Z"));
    await store.loadEvents();

    expect(toastMessages()).toHaveLength(2);
  });

  it("resets throttling when switching sessions", async () => {
    getSessionEvents.mockRejectedValue(new Error("events unavailable"));
    getSessionDetail.mockResolvedValue({ id: "session-b" } as never);
    const store = useSessionDetailStore();
    store.sessionId = "session-a";

    await store.loadEvents();
    expect(toastMessages()).toHaveLength(1);

    await store.loadDetail("session-b");
    await store.loadEvents();

    expect(toastMessages()).toHaveLength(2);
  });
});
