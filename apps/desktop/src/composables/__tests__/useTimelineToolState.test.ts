import { describe, expect, it } from "vitest";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { mountTimelineToolState, setupTimelineToolStateTest } from "./useTimelineToolState/setup";

setupTimelineToolStateTest();

describe("useTimelineToolState store and loader access", () => {
  it("provides sessionDetail store", () => {
    const wrapper = mountTimelineToolState();

    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.store).toBe(useSessionDetailStore());
  });

  it("provides preferences store", () => {
    const wrapper = mountTimelineToolState();

    expect(wrapper.vm.prefs).toBeDefined();
  });

  it("exposes tool result loader return values", () => {
    const wrapper = mountTimelineToolState();

    expect(wrapper.vm.fullResults).toBeDefined();
    expect(wrapper.vm.loadingResults).toBeDefined();
    expect(wrapper.vm.failedResults).toBeDefined();
    expect(wrapper.vm.loadFullResult).toBeTypeOf("function");
    expect(wrapper.vm.retryFullResult).toBeTypeOf("function");
  });
});
