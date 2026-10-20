import { createDeferred, type Deferred, setupPinia } from "@tracepilot/test-utils";
import type { EventsResponse } from "@tracepilot/types";
import { ErrorAlert, FilterSelect } from "@tracepilot/ui";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import EventsTab from "../EventsTab.vue";

const store = reactive({
  sessionId: "s1",
  events: null as EventsResponse | null,
  eventsError: null as string | null,
  eventsRefreshVersion: 0,
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
      data: { content: `message ${offset + i}` },
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
  store.eventsRefreshVersion = 0;
  store.loaded = new Set();
  store.loadEvents.mockReset();
});

function mountTab() {
  setupPinia();
  return mount(EventsTab, { attachTo: document.body });
}

/** The first event row's row number and ID, as shown. */
function firstRow(wrapper: ReturnType<typeof mountTab>) {
  const cells = wrapper.find("tbody tr").findAll("td");
  return { rowNum: cells[1].text(), id: cells[4].text() };
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

it("groups a large event total the way the session Overview does", async () => {
  store.loadEvents.mockImplementation(async () => {
    store.events = page(0, 12_345);
    store.loaded.add("events");
  });
  const wrapper = mountTab();
  await flushPromises();
  const text = wrapper.text();
  wrapper.unmount();
  expect(text).toContain("12,345 total events");
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
  expect(firstRow(wrapper)).toMatchObject({ rowNum: "1", id: "e0" });

  // Retry asks for the page that failed, and only then moves to it.
  loadSucceeds();
  wrapper.getComponent(ErrorAlert).vm.$emit("retry");
  await flushPromises();
  expect(store.loadEvents).toHaveBeenLastCalledWith(50, 50, undefined);
  expect(wrapper.text()).toContain("Page 2 of 3");
  expect(firstRow(wrapper)).toMatchObject({ rowNum: "51", id: "e50" });
  wrapper.unmount();
});

function button(wrapper: ReturnType<typeof mountTab>, label: string) {
  const found = wrapper.findAll("button").find((b) => b.text().includes(label));
  if (!found) throw new Error(`No ${label} button`);
  return found;
}

it("refetches the page and filter in view when the session is refreshed, keeping its rows meanwhile", async () => {
  loadSucceeds();
  const wrapper = mountTab();
  await flushPromises();
  wrapper.getComponent(FilterSelect).vm.$emit("update:modelValue", "user.message");
  await flushPromises();
  await button(wrapper, "Next").trigger("click");
  await flushPromises();
  expect(store.loadEvents).toHaveBeenLastCalledWith(50, 50, "user.message");
  expect(wrapper.text()).toContain("Page 2 of 3");

  // The session gains ten events, then the header Refresh, the running-session
  // poll or a live update refreshes it.
  const refetch = createDeferred<void>();
  store.loadEvents.mockClear();
  store.loadEvents.mockImplementation(async (offset: number) => {
    await refetch.promise;
    store.events = page(offset, 130);
  });
  store.eventsRefreshVersion += 1;
  await flushPromises();
  expect(store.loadEvents).toHaveBeenCalledTimes(1);
  expect(store.loadEvents).toHaveBeenLastCalledWith(50, 50, "user.message");
  // While it reloads, the page stays on screen.
  expect(wrapper.text()).toContain("120 matching events");
  expect(wrapper.text()).toContain("Page 2 of 3");
  expect(firstRow(wrapper).id).toBe("e50");

  refetch.resolve();
  await flushPromises();
  expect(wrapper.text()).toContain("130 matching events");
  expect(wrapper.text()).toContain("Page 2 of 3");
  expect(firstRow(wrapper)).toMatchObject({ rowNum: "51", id: "e50" });
  wrapper.unmount();
});

it("lets a page the user asks for during a refresh win over the refresh", async () => {
  loadSucceeds();
  const wrapper = mountTab();
  await flushPromises();

  // Like the store, a load another load superseded applies nothing.
  const requests: { offset: number; done: Deferred<void> }[] = [];
  let latest = 0;
  store.loadEvents.mockImplementation(async (offset: number) => {
    const seq = ++latest;
    const done = createDeferred<void>();
    requests.push({ offset, done });
    await done.promise;
    if (seq === latest) store.events = page(offset, 130);
  });
  store.eventsRefreshVersion += 1;
  await flushPromises();
  expect(requests.map((r) => r.offset)).toEqual([0]);

  // The refresh doesn't hold up paging.
  await button(wrapper, "Next").trigger("click");
  await flushPromises();
  expect(requests.map((r) => r.offset)).toEqual([0, 50]);

  requests[1].done.resolve();
  await flushPromises();
  requests[0].done.resolve();
  await flushPromises();
  expect(wrapper.text()).toContain("Page 2 of 3");
  expect(firstRow(wrapper)).toMatchObject({ rowNum: "51", id: "e50" });
  expect(button(wrapper, "Next").attributes("disabled")).toBeUndefined();
  wrapper.unmount();
});

it("opens an event's payload as pretty-printed JSON from its row or its toggle", async () => {
  loadSucceeds();
  const wrapper = mountTab();
  await flushPromises();
  const toggle = wrapper.get('button[aria-label="Show payload of event 2"]');
  expect(toggle.attributes("aria-expanded")).toBe("false");
  expect(wrapper.text()).not.toContain("message 1");

  await toggle.trigger("click");
  const shown = wrapper.get('button[aria-label="Hide payload of event 2"]');
  expect(shown.attributes("aria-expanded")).toBe("true");
  const payload = wrapper.get(`#${shown.attributes("aria-controls")}`);
  expect(payload.text()).toContain('"content": "message 1"');

  // A click anywhere on the row toggles it too.
  await wrapper.findAll("tbody tr")[0].trigger("click");
  expect(wrapper.find('button[aria-label="Hide payload of event 1"]').exists()).toBe(true);
  await shown.trigger("click");
  expect(wrapper.text()).not.toContain("message 1");
  wrapper.unmount();
});

it("keeps payloads open across a refresh and closes them on another page", async () => {
  loadSucceeds();
  const wrapper = mountTab();
  await flushPromises();
  await wrapper.get('button[aria-label="Show payload of event 1"]').trigger("click");

  store.eventsRefreshVersion += 1;
  await flushPromises();
  expect(store.loadEvents).toHaveBeenLastCalledWith(0, 50, undefined);
  expect(wrapper.text()).toContain('"content": "message 0"');

  await button(wrapper, "Next").trigger("click");
  await flushPromises();
  await button(wrapper, "Previous").trigger("click");
  await flushPromises();
  expect(wrapper.find('button[aria-expanded="true"]').exists()).toBe(false);
  expect(wrapper.text()).not.toContain('"content": "message 0"');
  wrapper.unmount();
});

it("dates event times when the session spans days, with the full time as a tooltip", async () => {
  // Noon on Jan 1 and noon on Jan 3 (UTC): different days in every time zone.
  const times = ["2026-01-01T12:00:00Z", "2026-01-03T12:00:00Z"];
  const load = (timestamps: string[]) =>
    store.loadEvents.mockImplementation(async () => {
      store.events = {
        events: timestamps.map((timestamp, i) => ({
          eventType: "user.message",
          timestamp,
          id: `e${i}`,
          data: {},
        })),
        totalCount: timestamps.length,
        hasMore: false,
        allEventTypes: ["user.message"],
      };
      store.loaded.add("events");
    });
  const timeCell = (wrapper: ReturnType<typeof mountTab>, row: number) =>
    wrapper.findAll("tbody tr")[row].findAll("td")[3].get("span");
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

  load(times);
  const wrapper = mountTab();
  await flushPromises();
  expect(timeCell(wrapper, 0).text()).toContain(day(times[0]));
  expect(timeCell(wrapper, 1).text()).toContain(day(times[1]));
  expect(timeCell(wrapper, 1).attributes("title")).toBe(new Date(times[1]).toLocaleString());
  wrapper.unmount();

  // Within one day, the clock alone places each row.
  load([times[0], times[0]]);
  const sameDay = mountTab();
  await flushPromises();
  expect(timeCell(sameDay, 0).text()).not.toContain(day(times[0]));
  expect(timeCell(sameDay, 0).attributes("title")).toBe(new Date(times[0]).toLocaleString());
  sameDay.unmount();
});
