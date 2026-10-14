import { setupPinia } from "@tracepilot/test-utils";
import type { EventsResponse } from "@tracepilot/types";
import { DataTable, ErrorAlert } from "@tracepilot/ui";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import EventsTab from "../EventsTab.vue";

const store = reactive({
  sessionId: "s1",
  events: null as EventsResponse | null,
  eventsError: null as string | null,
  loaded: new Set<string>(),
  loadEvents: vi.fn(),
});
vi.mock("@/composables/useSessionDetailContext", () => ({ useSessionDetailContext: () => store }));

function page(offset: number, totalCount = 120): EventsResponse {
  const count = Math.min(50, totalCount - offset);
  return {
    events: Array.from({ length: count }, (_, i) => ({
      eventType: "user.message",
      timestamp: "2026-01-01T00:00:00Z",
      id: `e${offset + i}`,
      data: {},
    })),
    totalCount,
    hasMore: offset + count < totalCount,
    allEventTypes: ["user.message"],
  };
}

/** Mirrors the store: success replaces events, failure sets eventsError and never throws. */
function loadSucceeds() {
  store.loadEvents.mockImplementation(async (offset: number) => {
    store.eventsError = null;
    store.events = page(offset);
    store.loaded.add("events");
  });
}

afterEach(() => {
  store.events = null;
  store.eventsError = null;
  store.loaded = new Set();
  store.loadEvents.mockReset();
});

function mountTab() {
  setupPinia();
  return mount(EventsTab);
}

it("says events are loading, not that there are none, until the first page loads", async () => {
  store.loadEvents.mockImplementation(() => new Promise(() => {}));
  const wrapper = mountTab();
  expect(store.loadEvents).toHaveBeenCalledWith(0, 50);
  expect(wrapper.get('[role="status"]').text()).toContain("Loading events");
  expect(wrapper.text()).not.toContain("0 total events");
  expect(wrapper.text()).not.toContain("No events found.");

  store.events = { events: [], totalCount: 0, hasMore: false, allEventTypes: [] };
  store.loaded.add("events");
  await nextTick();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.text()).toContain("0 total events");
  expect(wrapper.text()).toContain("No events found.");
  wrapper.unmount();
});

it("shows a failed first load as an error, never as zero events", async () => {
  store.loadEvents.mockImplementation(async () => {
    store.eventsError = "Couldn't read events.jsonl";
  });
  const wrapper = mountTab();
  await flushPromises();
  expect(wrapper.getComponent(ErrorAlert).props("message")).toBe("Couldn't read events.jsonl");
  expect(wrapper.text()).not.toContain("No events found.");
  expect(wrapper.text()).not.toContain("0 total events");
  expect(wrapper.find('[role="status"]').exists()).toBe(false);

  loadSucceeds();
  wrapper.getComponent(ErrorAlert).vm.$emit("retry");
  await flushPromises();
  expect(wrapper.findComponent(ErrorAlert).exists()).toBe(false);
  expect(wrapper.text()).toContain("120 total events");
  wrapper.unmount();
});

it("keeps the shown page's label and row numbers when the next page fails", async () => {
  loadSucceeds();
  const wrapper = mountTab();
  await flushPromises();
  expect(wrapper.text()).toContain("Page 1 of 3");

  store.loadEvents.mockImplementation(async () => {
    store.eventsError = "Couldn't read events.jsonl";
  });
  const next = wrapper.findAll("button").find((b) => b.text().includes("Next"));
  await next?.trigger("click");
  await flushPromises();
  expect(store.loadEvents).toHaveBeenLastCalledWith(50, 50, undefined);
  expect(wrapper.findComponent(ErrorAlert).exists()).toBe(true);
  expect(wrapper.text()).toContain("Page 1 of 3");
  expect(wrapper.getComponent(DataTable).props("rows")[0]).toMatchObject({ id: "e0", rowNum: 1 });

  // Retry asks for the page that failed, and only then moves to it.
  loadSucceeds();
  wrapper.getComponent(ErrorAlert).vm.$emit("retry");
  await flushPromises();
  expect(store.loadEvents).toHaveBeenLastCalledWith(50, 50, undefined);
  expect(wrapper.text()).toContain("Page 2 of 3");
  expect(wrapper.getComponent(DataTable).props("rows")[0]).toMatchObject({ id: "e50", rowNum: 51 });
  wrapper.unmount();
});
