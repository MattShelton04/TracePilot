import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RendererShell from "../components/RendererShell.vue";

describe("RendererShell (spec primitive)", () => {
  it("renders toolName, status pill, and default body slot", () => {
    const w = mount(RendererShell, {
      props: { toolName: "edit_file", status: "success" },
      slots: { default: '<div class="body">x</div>' },
    });
    expect(w.attributes("data-tp-component")).toBe("RendererShell");
    expect(w.find(".rs__name").text()).toBe("edit_file");
    expect(w.classes()).toContain("rs--success");
    expect(w.find(".body").exists()).toBe(true);
    expect(w.findComponent({ name: "StatusPill" }).exists()).toBe(true);
  });

  it("applies status-specific class for each variant", () => {
    for (const status of ["pending", "success", "warning", "error", "cancelled"] as const) {
      const w = mount(RendererShell, {
        props: { toolName: "t", status },
        slots: { default: "<p>x</p>" },
      });
      expect(w.classes()).toContain(`rs--${status}`);
    }
  });

  it("sets aria-busy on pending status", () => {
    const w = mount(RendererShell, {
      props: { toolName: "t", status: "pending" },
      slots: { default: "<p>x</p>" },
    });
    expect(w.attributes("aria-busy")).toBe("true");
  });

  it("renders primaryHint on right of header", () => {
    const w = mount(RendererShell, {
      props: { toolName: "edit_file", status: "success", primaryHint: "packages/ui/Btn.vue" },
      slots: { default: "<p>x</p>" },
    });
    expect(w.find(".rs__hint").text()).toBe("packages/ui/Btn.vue");
  });

  it("renders durationMs and tokenUsage in default footer", () => {
    const w = mount(RendererShell, {
      props: {
        toolName: "edit_file",
        status: "success",
        durationMs: 124,
        tokenUsage: { in: 312, out: 88 },
      },
      slots: { default: "<p>x</p>" },
    });
    expect(w.find(".rs__foot").exists()).toBe(true);
    expect(w.text()).toContain("124ms");
    expect(w.text()).toContain("312 in / 88 out");
  });

  it("formats long durations as seconds", () => {
    const w = mount(RendererShell, {
      props: { toolName: "t", status: "success", durationMs: 2500 },
      slots: { default: "<p>x</p>" },
    });
    expect(w.text()).toContain("2.50s");
  });

  it("collapsible: toggles body on click and emits toggle event", async () => {
    const w = mount(RendererShell, {
      props: { toolName: "t", status: "success", collapsible: true },
      slots: { default: '<div class="body">x</div>' },
    });
    expect(w.find(".body").exists()).toBe(true);
    const btn = w.find(".rs__toggle");
    expect(btn.attributes("aria-expanded")).toBe("true");
    await btn.trigger("click");
    expect(btn.attributes("aria-expanded")).toBe("false");
    expect(w.find(".body").exists()).toBe(false);
    expect(w.emitted("toggle")).toEqual([[true]]);
  });

  it("starts collapsed when defaultCollapsed=true", () => {
    const w = mount(RendererShell, {
      props: { toolName: "t", status: "success", collapsible: true, defaultCollapsed: true },
      slots: { default: '<div class="body">x</div>' },
    });
    expect(w.find(".body").exists()).toBe(false);
  });

  it("renders custom tabs slot", () => {
    const w = mount(RendererShell, {
      props: { toolName: "t", status: "success" },
      slots: {
        default: "<p>body</p>",
        tabs: '<div class="my-tabs">[args] [result]</div>',
      },
    });
    expect(w.find(".rs__tabs .my-tabs").exists()).toBe(true);
  });

  it("renders custom footer slot when provided", () => {
    const w = mount(RendererShell, {
      props: { toolName: "t", status: "success", durationMs: 100 },
      slots: {
        default: "<p>body</p>",
        footer: '<div class="my-foot">custom</div>',
      },
    });
    expect(w.find(".my-foot").exists()).toBe(true);
    expect(w.find(".rs__foot").exists()).toBe(false);
  });

  it("shows Copy button when copyText is provided", () => {
    const w = mount(RendererShell, {
      props: { toolName: "t", status: "success", copyText: "hello" },
      slots: { default: "<p>x</p>" },
    });
    const btns = w.findAll(".rs__action");
    expect(btns.some((b) => b.text() === "Copy")).toBe(true);
  });
});
