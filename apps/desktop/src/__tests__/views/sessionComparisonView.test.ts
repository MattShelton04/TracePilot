import type { ConversationTurn, ShutdownMetrics } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import SessionComparisonView from "../../views/SessionComparisonView.vue";

vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({
    sessions: [
      { id: "a", summary: "Alpha", turnCount: 1 },
      { id: "b", summary: "Bravo", turnCount: 1 },
      { id: "c", summary: "Charlie", turnCount: 1 },
    ],
    fetchSessions: vi.fn(async () => {}),
  }),
}));
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ hideEmptySessions: false, costPerPremiumRequest: 0.04 }),
}));

const client = vi.hoisted(() => ({
  getSessionDetail: vi.fn(async (id: string) => ({ id, summary: id, eventCount: 1 })),
  getShutdownMetrics: vi.fn(async (_id: string) => null as ShutdownMetrics | null),
  getSessionTurns: vi.fn(async (_id: string) => ({ turns: [] as ConversationTurn[] })),
}));
vi.mock("@tracepilot/client", () => client);

const Elsewhere = defineComponent({ template: "<div>elsewhere</div>" });

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/compare", name: "compare", component: SessionComparisonView },
      { path: "/sessions", name: "sessions", component: Elsewhere },
    ],
  });
}

async function mountAt(router: Router, path: string) {
  await router.push(path);
  const wrapper = mount(defineComponent({ template: "<router-view />" }), {
    global: { plugins: [router] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

async function pick(wrapper: Awaited<ReturnType<typeof mountAt>>, side: "A" | "B", text: string) {
  const box = wrapper.get<HTMLInputElement>(`[role="combobox"][aria-label="Session ${side}"]`);
  box.element.focus();
  await box.setValue(text);
  await box.trigger("keydown", { key: "ArrowDown" });
  await box.trigger("keydown", { key: "Enter" });
  await flushPromises();
}

describe("SessionComparisonView route state", () => {
  beforeEach(() => {
    client.getSessionDetail.mockClear();
    document.body.innerHTML = "";
  });

  it("keeps both picks in the URL, so Back restores the comparison", async () => {
    const router = makeRouter();
    const wrapper = await mountAt(router, "/compare");
    await pick(wrapper, "A", "Alpha");
    await pick(wrapper, "B", "Bravo");
    expect(router.currentRoute.value.query).toEqual({ a: "a", b: "b" });

    await wrapper.get(".compare-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".summary-pair").exists()).toBe(true);

    await router.push("/sessions");
    await flushPromises();
    expect(wrapper.text()).toContain("elsewhere");

    router.back();
    await flushPromises();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/compare?a=a&b=b");
    const names = wrapper.findAll(".session-name").map((n) => n.text());
    expect(names).toEqual(["a", "b"]);
    wrapper.unmount();
  });

  it("opens a shared link as a comparison, and ignores a pair that cannot be compared", async () => {
    const shared = await mountAt(makeRouter(), "/compare?a=b&b=c");
    expect(shared.findAll(".session-name").map((n) => n.text())).toEqual(["b", "c"]);
    shared.unmount();

    client.getSessionDetail.mockClear();
    const same = await mountAt(makeRouter(), "/compare?a=b&b=b");
    expect(client.getSessionDetail).not.toHaveBeenCalled();
    expect(same.text()).toContain("Select Two Sessions");
    same.unmount();
  });

  it("says why Compare is off when both sides hold the same session", async () => {
    const wrapper = await mountAt(makeRouter(), "/compare");
    await pick(wrapper, "A", "Bravo");
    await pick(wrapper, "B", "Bravo");
    expect(wrapper.get<HTMLButtonElement>(".compare-btn").element.disabled).toBe(true);
    expect(wrapper.text()).toContain("Both sides hold the same session.");
    expect(wrapper.text()).not.toContain("click Compare");
    wrapper.unmount();

    // After a comparison, re-picking the same session doesn't ask for a Compare it can't run.
    const compared = await mountAt(makeRouter(), "/compare?a=a&b=b");
    await pick(compared, "A", "Bravo");
    expect(compared.text()).toContain("Pick another session to compare.");
    expect(compared.text()).not.toContain("Click Compare to update them");
    compared.unmount();
  });

  it("keeps the picks and results when the sidebar opens Compare without picks", async () => {
    const router = makeRouter();
    const wrapper = await mountAt(router, "/compare?a=a&b=b");
    client.getSessionDetail.mockClear();

    await router.push("/compare");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ a: "a", b: "b" });
    expect(wrapper.findAll(".session-name").map((n) => n.text())).toEqual(["a", "b"]);
    expect(wrapper.text()).not.toContain("Selection changed.");
    expect(wrapper.get<HTMLButtonElement>(".compare-btn").element.disabled).toBe(false);
    expect(client.getSessionDetail).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("does not re-run the comparison when a re-pick updates the URL", async () => {
    const router = makeRouter();
    const wrapper = await mountAt(router, "/compare?a=a&b=b");
    client.getSessionDetail.mockClear();

    await pick(wrapper, "A", "Charlie");
    expect(router.currentRoute.value.query).toEqual({ a: "c", b: "b" });
    expect(client.getSessionDetail).not.toHaveBeenCalled();
    expect(wrapper.findAll(".session-name").map((n) => n.text())).toEqual(["a", "b"]);
    expect(wrapper.text()).toContain("Click Compare to update them");
    wrapper.unmount();
  });
});
