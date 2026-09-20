import {
  agentUsage,
  agentFields as fields,
  agentSettings as settings,
} from "@tracepilot/client/mock";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Component, defineComponent, h, provide, reactive } from "vue";
import { type AgentEditorContext, AgentEditorKey } from "@/composables/useAgentEditor";
import { resolveEffectiveConfig } from "@/utils/agents/effective";
import AgentEffectiveTab from "../AgentEffectiveTab.vue";
import AgentMetadataForm from "../AgentMetadataForm.vue";
import AgentModelList from "../AgentModelList.vue";
import AgentOverrideDialog from "../AgentOverrideDialog.vue";
import AgentPreviewTab from "../AgentPreviewTab.vue";
import AgentUsageTab from "../AgentUsageTab.vue";

enableAutoUnmount(afterEach);
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tracepilot/ui");
  return {
    ...actual,
    MarkdownContent: {
      name: "MarkdownContent",
      props: ["content"],
      template: '<div class="md-stub">{{ content }}</div>',
    },
  };
});

function makeCtx(overrides: Partial<AgentEditorContext> = {}) {
  const draft = fields({ name: "reviewer", description: "Reviews code", models: ["gpt-5.4-mini"] });
  const base = {
    detail: {
      summary: { fileStem: "reviewer", format: "markdown", scope: "personal" },
      otherFields: [],
    },
    fields: draft,
    body: "Use {{grepToolName}} then {{copilot:memories}}.",
    usage: null,
    agentName: "reviewer",
    isReadOnly: false,
    settings: settings(),
    override: null,
    disabled: false,
    effective: resolveEffectiveConfig(draft, null, settings(), false),
    patchFields: vi.fn(),
    ...overrides,
  };
  return reactive(base) as unknown as AgentEditorContext;
}

function host(child: Component, ctx: AgentEditorContext) {
  return defineComponent({
    setup() {
      provide(AgentEditorKey, ctx);
      return () => h(child);
    },
  });
}

describe("AgentMetadataForm", () => {
  it("patches only the field that changed, and drops an emptied key", async () => {
    const ctx = makeCtx();
    const wrapper = mount(host(AgentMetadataForm, ctx));

    await wrapper.get("#agent-description").setValue("New description");
    expect(ctx.patchFields).toHaveBeenLastCalledWith({ description: "New description" });

    await wrapper.get("#agent-description").setValue("   ");
    expect(ctx.patchFields).toHaveBeenLastCalledWith({ description: null });
  });

  it("turns the tools text into a list, and an empty value into the absent key", async () => {
    const ctx = makeCtx();
    const wrapper = mount(host(AgentMetadataForm, ctx));

    await wrapper.get("#agent-tools").setValue("grep, glob , shell");
    expect(ctx.patchFields).toHaveBeenLastCalledWith({ tools: ["grep", "glob", "shell"] });

    await wrapper.get("#agent-tools").setValue("");
    expect(ctx.patchFields).toHaveBeenLastCalledWith({ tools: null });
  });

  it("keeps an effort value the CLI knows but TracePilot does not", () => {
    const ctx = makeCtx({ fields: fields({ reasoningEffort: "xhigh" }) });
    const wrapper = mount(host(AgentMetadataForm, ctx));
    const options = wrapper.findAll("#agent-effort option").map((o) => o.attributes("value"));
    expect(options).toContain("xhigh");
  });

  it("disables every control when the definition is read-only", () => {
    const ctx = makeCtx({ isReadOnly: true });
    const wrapper = mount(host(AgentMetadataForm, ctx));
    expect(wrapper.get("#agent-effort").attributes("disabled")).toBeDefined();
    expect(wrapper.get("#agent-name").attributes("readonly")).toBeDefined();
  });
});

describe("AgentModelList", () => {
  it("reorders and removes models without mutating the prop", async () => {
    const models = ["a", "b"];
    const wrapper = mount(AgentModelList, { props: { models, readonly: false } });

    await wrapper.get('[title="Move down"]').trigger("click");
    expect(wrapper.emitted("update")?.[0]?.[0]).toEqual(["b", "a"]);

    await wrapper.get('[title="Remove model"]').trigger("click");
    expect(wrapper.emitted("update")?.[1]?.[0]).toEqual(["b"]);
    expect(models).toEqual(["a", "b"]);
  });

  it("hides the editing controls when read-only", () => {
    const wrapper = mount(AgentModelList, { props: { models: ["a"], readonly: true } });
    expect(wrapper.find(".model-row__actions").exists()).toBe(false);
    expect(wrapper.find(".model-row__add").exists()).toBe(false);
  });
});

describe("AgentEffectiveTab", () => {
  it("names the /subagents override and what it shadows", () => {
    const draft = fields({ models: ["gpt-5.4-mini"] });
    const override = { model: "claude-opus-5", effortLevel: null, contextTier: null };
    const ctx = makeCtx({
      fields: draft,
      override,
      effective: resolveEffectiveConfig(draft, override, settings(), false),
    });
    const wrapper = mount(host(AgentEffectiveTab, ctx));
    expect(wrapper.text()).toContain("claude-opus-5");
    expect(wrapper.text()).toContain("definition says gpt-5.4-mini");
  });

  it("says the task call still wins", () => {
    const wrapper = mount(host(AgentEffectiveTab, makeCtx()));
    expect(wrapper.text()).toContain("wins over every value above");
  });
});

describe("AgentPreviewTab", () => {
  it("resolves known placeholders and marks the rest as runtime-filled", () => {
    const wrapper = mount(host(AgentPreviewTab, makeCtx()));
    expect(wrapper.get(".md-stub").text()).toContain("`grep`");
    expect(wrapper.text()).toContain("filled by the CLI at runtime");
  });
});

describe("AgentUsageTab", () => {
  it("keeps metric coverage and missing values visible in the timing section", () => {
    const stats = agentUsage("reviewer", { runs: 100 });
    stats.durationMs = { ...stats.durationMs, count: 27, p50: 1_000 };
    const ctx = makeCtx({
      usage: {
        stats,
        recentRuns: [],
        dispatch: [],
        failureReasons: [],
        invokedBy: [],
        depths: [],
        parallelism: [],
        repositories: [],
      },
      store: { range: "30d" },
    } as unknown as Partial<AgentEditorContext>);
    const wrapper = mount(host(AgentUsageTab, ctx));
    const metrics = wrapper.findAll(".metric-distribution");
    expect(metrics[0].text()).toContain("Based on 27 of 100 runs");
    expect(metrics[0].text()).toContain("1s");
    expect(metrics[1].text()).toContain("No runs reported this metric");
    expect(metrics[1].find("dl").exists()).toBe(false);
    expect(metrics[1].text()).toContain("can include descendant agents");
  });
});

describe("AgentOverrideDialog", () => {
  it("keeps a failed write open, shows its error, and does not apply the disable change", async () => {
    const setDisabled = vi.fn();
    const ctx = makeCtx({
      agentType: "reviewer",
      store: { error: "Settings are read-only" },
      setOverride: vi.fn().mockResolvedValue(false),
      setDisabled,
    } as unknown as Partial<AgentEditorContext>);
    const wrapper = mount(
      defineComponent({
        setup() {
          provide(AgentEditorKey, ctx);
          return () => h(AgentOverrideDialog, { visible: true });
        },
      }),
      { global: { stubs: { Teleport: true } } },
    );
    await wrapper.get('[role="switch"]').trigger("click");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Apply")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("Settings are read-only");
    expect(setDisabled).not.toHaveBeenCalled();
    expect(wrapper.getComponent(AgentOverrideDialog).emitted("update:visible")).toBeUndefined();
  });
});
