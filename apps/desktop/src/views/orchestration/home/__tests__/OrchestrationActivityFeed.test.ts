// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import {
  FIXTURE_SYSTEM_DEPS,
  mockCheckSystemDeps,
  mockListSessions,
} from "@/__tests__/stores/orchestrationHome/setup";
import type { SessionListItem } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/stores/preferences";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";
import OrchestrationActivityFeed from "../OrchestrationActivityFeed.vue";
import OrchestrationHeroStats from "../OrchestrationHeroStats.vue";

const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const PLACEHOLDER_TEXT = [
  "Session started in tracepilot",
  "Batch run completed",
  "Budget threshold reached",
  "Agent config updated",
];

function session(overrides: Partial<SessionListItem>): SessionListItem {
  return {
    id: "s-1",
    summary: "Fix the flaky login test",
    repository: "example/orchard",
    cwd: null,
    createdAt: "2026-03-28T08:00:00Z",
    updatedAt: "2026-03-28T09:00:00Z",
    isRunning: false,
    eventCount: 20,
    turnCount: 3,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function expectNoPlaceholders(text: string) {
  for (const placeholder of PLACEHOLDER_TEXT) expect(text).not.toContain(placeholder);
}

describe("OrchestrationActivityFeed", () => {
  it("shows a loading state, not placeholder activity, until sessions arrive", async () => {
    mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
    const sessions = deferred<SessionListItem[]>();
    mockListSessions.mockReturnValue(sessions.promise);
    const store = useOrchestrationHomeStore();
    const wrapper = mount(OrchestrationActivityFeed);

    const init = store.initialize();
    await flushPromises();
    // The page renders as soon as the fast path lands; sessions are still loading.
    expect(store.loading).toBe(false);
    expectNoPlaceholders(wrapper.text());
    expect(wrapper.get('[role="status"]').text()).toContain("Loading recent sessions");

    sessions.resolve([session({})]);
    await init;
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Fix the flaky login test");
  });

  it("says there is no activity rather than inventing some", async () => {
    mockListSessions.mockResolvedValue([]);
    const store = useOrchestrationHomeStore();
    const wrapper = mount(OrchestrationActivityFeed);
    await store.initialize();
    await flushPromises();

    expectNoPlaceholders(wrapper.text());
    expect(wrapper.text()).toContain("No sessions yet");
    expect(wrapper.findAll("button.feed-item")).toHaveLength(0);
  });

  it("names each session by its title and repository, or its folder", async () => {
    mockListSessions.mockResolvedValue([
      session({ id: "a", summary: "Add retry to uploads", isRunning: true, runStatus: "busy" }),
      session({
        id: "b",
        summary: null,
        repository: null,
        cwd: "C:\\work\\harbor",
        source: "claudeCode",
      }),
    ]);
    const store = useOrchestrationHomeStore();
    const wrapper = mount(OrchestrationActivityFeed);
    await store.initialize();
    await flushPromises();

    const rows = wrapper.findAll("button.feed-item");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Add retry to uploads");
    expect(rows[0].text()).toContain("example/orchard");
    expect(rows[0].text()).toContain("Busy");
    expect(rows[1].text()).toContain("Untitled Session");
    expect(rows[1].text()).toContain("harbor");
    expect(rows[1].text()).toContain("Last active");
    expect(wrapper.text()).not.toContain("unknown");
    expect(wrapper.text()).not.toContain("completed");
  });

  it("opens the session from its row", async () => {
    mockListSessions.mockResolvedValue([session({ id: "abc-123" })]);
    const store = useOrchestrationHomeStore();
    const wrapper = mount(OrchestrationActivityFeed);
    await store.initialize();
    await flushPromises();

    const row = wrapper.get("button.feed-item");
    expect(row.attributes("type")).toBe("button");
    await row.trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "session-overview",
      params: { id: "abc-123" },
    });
  });

  it("leaves out empty sessions the session list hides, and counts what it shows", async () => {
    mockListSessions.mockResolvedValue([
      session({ id: "a", summary: "Real work" }),
      session({ id: "b", summary: "Never started", turnCount: 0 }),
    ]);
    usePreferencesStore().hideEmptySessions = true;
    const store = useOrchestrationHomeStore();
    const feed = mount(OrchestrationActivityFeed);
    const hero = mount(OrchestrationHeroStats);
    await store.initialize();
    await flushPromises();

    expect(feed.text()).toContain("Real work");
    expect(feed.text()).not.toContain("Never started");
    const total = hero.findAll(".hero-card").at(-1)!;
    expect(total.get(".hero-value").text()).toBe("1");
    expect(total.get(".hero-sub").text()).toContain("1 empty session hidden");

    usePreferencesStore().hideEmptySessions = false;
    await flushPromises();
    expect(feed.text()).toContain("Never started");
    expect(total.get(".hero-value").text()).toBe("2");
  });

  it("does not claim zero sessions before they have loaded", async () => {
    const sessions = deferred<SessionListItem[]>();
    mockListSessions.mockReturnValue(sessions.promise);
    const store = useOrchestrationHomeStore();
    const hero = mount(OrchestrationHeroStats);
    const init = store.initialize();
    await flushPromises();

    const values = hero.findAll(".hero-value").map((v) => v.text());
    expect(values[0]).toBe("—");
    expect(values.at(-1)).toBe("—");
    expect(hero.text()).not.toContain("None running");

    sessions.resolve([session({})]);
    await init;
    await flushPromises();
    expect(hero.findAll(".hero-value").at(-1)!.text()).toBe("1");
  });
});
