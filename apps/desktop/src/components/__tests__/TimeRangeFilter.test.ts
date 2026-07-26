import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import TimeRangeFilter from "../TimeRangeFilter.vue";

describe("TimeRangeFilter", () => {
  beforeEach(() => {
    setupPinia();
  });

  it("offers This Month between 90 Days and Custom", () => {
    const wrapper = mount(TimeRangeFilter);
    const labels = wrapper.findAll(".time-range-btn").map((button) => button.text());

    expect(labels).toEqual(["All Time", "7 Days", "30 Days", "90 Days", "This Month", "Custom"]);
  });
});
