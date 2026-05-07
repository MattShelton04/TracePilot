import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ObjectiveBanner from "../components/ObjectiveBanner.vue";
import type { CurrentObjective } from "../utils/objective";

const sample: CurrentObjective = {
  text: "Implementing objective banner",
  toolCallId: "tc-1",
  eventIndex: 12,
  timestamp: "2024-01-01T00:00:00Z",
  updateCount: 1,
};

describe("ObjectiveBanner", () => {
  it("renders the objective text and accent label", () => {
    const w = mount(ObjectiveBanner, { props: { objective: sample } });
    expect(w.find(".ob-text").text()).toBe(sample.text);
    expect(w.find(".ob-label").text()).toBe("Current objective");
  });

  it("falls back to a muted empty state when objective is null", () => {
    const w = mount(ObjectiveBanner, { props: { objective: null } });
    expect(w.classes()).toContain("empty");
    expect(w.find(".empty-text").text()).toBe("No objective reported yet");
    expect(w.find(".ob-status").text()).toBe("Awaiting objective");
  });

  it("shows an updates badge when the objective changed multiple times", () => {
    const w = mount(ObjectiveBanner, {
      props: { objective: { ...sample, updateCount: 4 } },
    });
    expect(w.find(".ob-updates").text()).toBe("Updated 4×");
  });

  it("does not show updates badge for a single-update objective", () => {
    const w = mount(ObjectiveBanner, { props: { objective: sample } });
    expect(w.find(".ob-updates").exists()).toBe(false);
  });

  it("renders the completed status pill with success styling", () => {
    const w = mount(ObjectiveBanner, {
      props: { objective: sample, status: "completed" },
    });
    const pill = w.find(".ob-status");
    expect(pill.text()).toBe("Completed");
    expect(pill.classes()).toContain("ob-status-completed");
  });

  it("emits reveal with deep-link metadata when objective is clicked", async () => {
    const w = mount(ObjectiveBanner, { props: { objective: sample } });
    await w.find(".ob-text").trigger("click");
    const events = w.emitted("reveal");
    expect(events).toBeTruthy();
    expect(events![0][0]).toEqual({ eventIndex: 12, toolCallId: "tc-1" });
  });

  it("does not emit reveal when there is no objective", async () => {
    const w = mount(ObjectiveBanner, { props: { objective: null } });
    // The empty state renders a span, not a button — clicking should be a no-op.
    await w.find(".empty-text").trigger("click");
    expect(w.emitted("reveal")).toBeUndefined();
  });

  it("renders static objective text when no deep-link metadata is available", async () => {
    const w = mount(ObjectiveBanner, {
      props: { objective: { text: "Legacy objective", updateCount: 1 } },
    });
    expect(w.find("button.ob-text").exists()).toBe(false);
    expect(w.find(".ob-text-static").text()).toBe("Legacy objective");
    await w.find(".ob-text-static").trigger("click");
    expect(w.emitted("reveal")).toBeUndefined();
  });

  it("shows running progress treatment for active objectives", () => {
    const w = mount(ObjectiveBanner, { props: { objective: sample, status: "running" } });
    expect(w.find(".ob-status").classes()).toContain("ob-status-running");
    expect(w.find(".ob-progress").exists()).toBe(true);
  });

  it("exposes accessible status semantics", () => {
    const w = mount(ObjectiveBanner, { props: { objective: sample } });
    expect(w.attributes("role")).toBe("status");
    expect(w.attributes("aria-live")).toBe("polite");
    expect(w.attributes("aria-label")).toContain(sample.text);
  });

  it("applies the subagent accent color via CSS custom property", () => {
    const w = mount(ObjectiveBanner, {
      props: { objective: sample, scope: "subagent", accentColor: "#ff00aa" },
    });
    const style = w.attributes("style") ?? "";
    expect(style).toContain("--ob-accent: #ff00aa");
    expect(w.classes()).toContain("scope-subagent");
  });
});
