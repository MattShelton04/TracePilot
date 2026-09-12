import type { CopilotConfig } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import ConfigInjectorGlobalTab from "@/components/configInjector/ConfigInjectorGlobalTab.vue";
import { ConfigInjectorKey, useConfigInjector } from "../useConfigInjector";

vi.mock("@tracepilot/ui", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@tracepilot/ui")),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@tracepilot/client", () => ({ previewBackupRestore: vi.fn() }));
vi.mock("@/stores/configInjector", () => ({ useConfigInjectorStore: () => store }));

const store = reactive({
  agents: [],
  copilotConfig: null as CopilotConfig | null,
  saving: false,
  initialize: vi.fn(async () => {}),
  saveGlobalConfig: vi.fn(),
});

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  store.saving = false;
});

function config(overrides: Partial<CopilotConfig> = {}): CopilotConfig {
  return {
    model: "gpt-4.1",
    reasoningEffort: "medium",
    trustedFolders: ["/audit/project"],
    disabledSkills: [],
    raw: {},
    settingsPath: "/audit/.copilot/settings.json",
    ...overrides,
  };
}

async function harness(value: CopilotConfig) {
  store.copilotConfig = value;
  let api!: ReturnType<typeof useConfigInjector>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useConfigInjector();
        provide(ConfigInjectorKey, api);
        return () => h(ConfigInjectorGlobalTab);
      },
    }),
  );
  await flushPromises();
  return { api, wrapper };
}

describe("Config Injector boolean edits", () => {
  it.each(
    [
      { show: false, markdown: false },
      { show: false, markdown: true },
      { show: true, markdown: false },
      { show: true, markdown: true },
    ].flatMap((values) => [
      { ...values, source: "typed" },
      { ...values, source: "raw" },
    ]),
  )("tracks and saves independent boolean edits from $source ($show, $markdown)", async ({
    show,
    markdown,
    source,
  }) => {
    const { api, wrapper } = await harness(
      config(
        source === "typed"
          ? {
              showReasoning: show,
              renderMarkdown: markdown,
              raw: { showReasoning: !show, renderMarkdown: !markdown },
            }
          : { raw: { showReasoning: show, renderMarkdown: markdown } },
      ),
    );
    const switches = wrapper.findAll(".switch-track");
    const save = wrapper.get<HTMLButtonElement>(".config-form > .btn-primary");
    expect(api.editShowReasoning.value).toBe(show);
    expect(api.editRenderMarkdown.value).toBe(markdown);
    expect(api.hasConfigChanges.value).toBe(false);
    expect(save.element.disabled).toBe(true);

    await switches[0].trigger("click");
    expect(save.element.disabled).toBe(false);
    expect(wrapper.get(".diff-preview-details").text()).toContain('"showReasoning"');
    await switches[0].trigger("click");
    expect(api.hasConfigChanges.value).toBe(false);
    expect(save.element.disabled).toBe(true);

    await switches[1].trigger("click");
    expect(save.element.disabled).toBe(false);
    expect(wrapper.get(".diff-preview-details").text()).toContain('"renderMarkdown"');
    await save.trigger("click");
    expect(store.saveGlobalConfig).toHaveBeenCalledWith({
      model: "gpt-4.1",
      reasoningEffort: "medium",
      showReasoning: show,
      renderMarkdown: !markdown,
      trustedFolders: ["/audit/project"],
    });
    await switches[1].trigger("click");
    expect(api.hasConfigChanges.value).toBe(false);
    expect(save.element.disabled).toBe(true);
  });

  it("uses identical defaults for missing booleans and becomes clean after saved state arrives", async () => {
    const { api, wrapper } = await harness(config());
    expect(api.editShowReasoning.value).toBe(false);
    expect(api.editRenderMarkdown.value).toBe(true);
    expect(api.hasConfigChanges.value).toBe(false);
    await wrapper.findAll(".switch-track")[0].trigger("click");
    expect(api.hasConfigChanges.value).toBe(true);
    store.copilotConfig = config({ showReasoning: true });
    expect(api.hasConfigChanges.value).toBe(false);
  });
});
