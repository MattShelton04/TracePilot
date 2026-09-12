import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { useAnalyticsPage } from "@/composables/useAnalyticsPage";
import { useAnalyticsStore } from "@/stores/analytics";
import TimeRangeFilter from "../TimeRangeFilter.vue";

describe("TimeRangeFilter", () => {
  const wrappers: VueWrapper[] = [];
  beforeEach(() => {
    setupPinia();
  });
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  async function customRange(from = "2026-09-12", to?: string) {
    const store = useAnalyticsStore();
    store.setTimeRange("custom", from || undefined, to);
    vi.spyOn(store, "fetchAvailableRepos").mockResolvedValue(undefined);
    const fetch = vi.spyOn(store, "fetchCodeImpact").mockResolvedValue(undefined);
    const wrapper = mount(
      defineComponent({
        setup() {
          useAnalyticsPage("fetchCodeImpact");
          return () => h(TimeRangeFilter);
        },
      }),
      { attachTo: document.body },
    );
    wrappers.push(wrapper);
    await flushPromises();
    fetch.mockClear();
    return { wrapper, store, fetch };
  }

  async function enterDate(wrapper: VueWrapper, label: "From date" | "To date", value: string) {
    const input = wrapper.get<HTMLInputElement>(`input[aria-label="${label}"]`);
    input.element.focus();
    await input.setValue(value);
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    return input;
  }

  function preset(wrapper: VueWrapper, label: string) {
    return wrapper.findAll(".time-range-btn").find((button) => button.text() === label)!;
  }

  it("offers This Month between 90 Days and Custom", () => {
    const wrapper = mount(TimeRangeFilter);
    wrappers.push(wrapper);
    const labels = wrapper.findAll(".time-range-btn").map((button) => button.text());

    expect(labels).toEqual(["All Time", "7 Days", "30 Days", "90 Days", "This Month", "Custom"]);
  });

  it("retains a reversed draft with accessible feedback and sends no invalid fetch", async () => {
    const { wrapper, store, fetch } = await customRange();
    const input = await enterDate(wrapper, "To date", "2026-08-01");
    expect(store.dateRange).toEqual({ fromDate: "2026-09-12", toDate: undefined });
    expect(fetch).not.toHaveBeenCalled();
    expect(input.element.value).toBe("2026-08-01");
    expect(input.attributes("aria-invalid")).toBe("true");
    const error = wrapper.get('[role="alert"]');
    expect(error.text()).toMatch(/From date must be on or before To date/);
    expect(error.text()).toMatch(/last valid range/);
    expect(input.attributes("aria-describedby")).toBe(error.attributes("id"));
  });

  it.each([
    "From date",
    "To date",
  ] as const)("allows correcting %s after a reversed draft", async (bound) => {
    const { wrapper, store, fetch } = await customRange();
    await enterDate(wrapper, "To date", "2026-08-01");
    await enterDate(wrapper, bound, bound === "From date" ? "2026-07-01" : "2026-10-01");
    expect(store.dateRange).toEqual(
      bound === "From date"
        ? { fromDate: "2026-07-01", toDate: "2026-08-01" }
        : { fromDate: "2026-09-12", toDate: "2026-10-01" },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it("clears either bound to restore a valid open-ended range", async () => {
    const { wrapper, store, fetch } = await customRange();
    await enterDate(wrapper, "To date", "2026-08-01");
    await enterDate(wrapper, "From date", "");
    expect(store.dateRange).toEqual({ fromDate: undefined, toDate: "2026-08-01" });
    await enterDate(wrapper, "To date", "");
    expect(store.dateRange).toEqual({ fromDate: undefined, toDate: undefined });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it.each([
    "1999-12-31",
    "2100-01-01",
  ])("rejects %s without changing stored dates", async (value) => {
    const { wrapper, store, fetch } = await customRange();
    const input = await enterDate(wrapper, "From date", value);
    expect(store.customFromDate).toBe("2026-09-12");
    expect(fetch).not.toHaveBeenCalled();
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(wrapper.get('[role="alert"]').text()).toMatch(/2000.*2099/);
  });

  it("allows inclusive boundary and equal dates, and does not commit mid-edit", async () => {
    const { wrapper, store, fetch } = await customRange("2000-01-01", "2099-12-31");
    const input = wrapper.get<HTMLInputElement>('input[aria-label="From date"]');
    input.element.focus();
    await input.setValue("2099-12-31");
    expect(store.customFromDate).toBe("2000-01-01");
    expect(fetch).not.toHaveBeenCalled();
    input.element.blur();
    await flushPromises();
    expect(store.dateRange).toEqual({ fromDate: "2099-12-31", toDate: "2099-12-31" });
    expect(fetch).toHaveBeenCalledTimes(1);
    input.element.focus();
    input.element.blur();
    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes native incomplete-date input from intentionally clearing a bound", async () => {
    const { wrapper, store, fetch } = await customRange();
    const input = wrapper.get<HTMLInputElement>('input[aria-label="From date"]');
    input.element.focus();
    input.element.value = "";
    Object.defineProperty(input.element, "validity", {
      configurable: true,
      value: { badInput: true },
    });
    input.element.blur();
    await flushPromises();
    expect(store.customFromDate).toBe("2026-09-12");
    expect(fetch).not.toHaveBeenCalled();
    expect(input.element.value).toBe("");
    expect(wrapper.get('[role="alert"]').text()).toMatch(/complete date/i);
  });

  it("keeps an incomplete bound invalid when editing the other date until both are corrected", async () => {
    const { wrapper, store, fetch } = await customRange();
    const from = wrapper.get<HTMLInputElement>('input[aria-label="From date"]');
    from.element.focus();
    from.element.value = "";
    Object.defineProperty(from.element, "validity", {
      configurable: true,
      value: { badInput: true },
    });
    from.element.blur();
    await enterDate(wrapper, "To date", "2026-10-01");
    expect(store.dateRange).toEqual({ fromDate: "2026-09-12", toDate: undefined });
    expect(fetch).not.toHaveBeenCalled();
    expect(from.attributes("aria-invalid")).toBe("true");
    Object.defineProperty(from.element, "validity", {
      configurable: true,
      value: { badInput: false },
    });
    await enterDate(wrapper, "From date", "2026-09-15");
    expect(store.dateRange).toEqual({ fromDate: "2026-09-15", toDate: "2026-10-01" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("discards invalid drafts on preset changes and restores the committed custom range", async () => {
    const { wrapper, store } = await customRange();
    await enterDate(wrapper, "To date", "2026-08-01");
    await preset(wrapper, "7 Days").trigger("click");
    expect(store.selectedTimeRange).toBe("7d");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    await preset(wrapper, "Custom").trigger("click");
    expect(store.dateRange).toEqual({ fromDate: "2026-09-12", toDate: undefined });
    expect(wrapper.get<HTMLInputElement>('input[aria-label="To date"]').element.value).toBe("");
  });

  it("remounts the saved range and synchronizes later changes from another consumer", async () => {
    const { wrapper, store } = await customRange();
    await enterDate(wrapper, "To date", "2026-08-01");
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    const remounted = mount(TimeRangeFilter, { attachTo: document.body });
    wrappers.push(remounted);
    await flushPromises();
    expect(remounted.get<HTMLInputElement>('input[aria-label="From date"]').element.value).toBe(
      "2026-09-12",
    );
    expect(remounted.get<HTMLInputElement>('input[aria-label="To date"]').element.value).toBe("");
    store.setTimeRange("custom", "2026-05-01", "2026-05-31");
    await flushPromises();
    expect(remounted.get<HTMLInputElement>('input[aria-label="From date"]').element.value).toBe(
      "2026-05-01",
    );
    expect(remounted.get<HTMLInputElement>('input[aria-label="To date"]').element.value).toBe(
      "2026-05-31",
    );
  });
});
