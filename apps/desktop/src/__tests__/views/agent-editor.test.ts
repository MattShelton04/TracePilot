// biome-ignore-all assist/source/organizeImports: mocks must be registered before the view import.
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

const { getEditor } = vi.hoisted(() => ({ getEditor: vi.fn() }));
vi.mock("@/composables/useAgentEditor", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/composables/useAgentEditor");
  return { ...actual, useAgentEditor: getEditor };
});
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));

import { resolveEffectiveConfig } from "@/utils/agents/effective";
import {
  agentDefinition as definition,
  agentFields as fields,
  agentSettings as settings,
} from "@tracepilot/client/mock";
import AgentEditorView from "@/views/agents/AgentEditorView.vue";

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());

function mountView(overrides: Record<string, unknown> = {}) {
  const draft = fields({ name: "reviewer", models: ["gpt-5.4-mini"] });
  const ctx = reactive({
    detail: {
      summary: definition("reviewer", { fields: draft }),
      rawContent: "---\nname: reviewer\n---\nBody",
      body: "Body",
      otherFields: [],
      mcpServers: null,
      diagnostics: [],
    },
    usage: null,
    fields: draft,
    body: "Body",
    rawDraft: "---\nname: reviewer\n---\nBody",
    rawMode: false,
    dirty: false,
    loading: false,
    usageLoading: false,
    saving: false,
    error: null as string | null,
    usageError: null as string | null,
    lastBackup: null as string | null,
    activeTab: "preview",
    leftWidth: 50,
    minLeftWidth: 25,
    maxLeftWidth: 75,
    dragging: false,
    containerRef: null,
    onMouseDown: vi.fn(),
    onResizeKeyDown: vi.fn(),
    routeId: "/defs/reviewer.agent.md",
    isSessionOnly: false,
    definitionPath: "/defs/reviewer.agent.md",
    agentName: "reviewer",
    agentType: "reviewer",
    settings: settings(),
    override: null,
    disabled: false,
    effective: resolveEffectiveConfig(draft, null, settings(), false),
    readOnlyReason: null as string | null,
    isReadOnly: false,
    canOverride: true,
    errorDiagnostics: [],
    canSave: false,
    saveState: "No changes",
    load: vi.fn(),
    loadUsage: vi.fn(),
    patchFields: vi.fn(),
    setBody: vi.fn(),
    setRaw: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    remove: vi.fn(),
    setOverride: vi.fn(),
    setDisabled: vi.fn(),
    goBack: vi.fn(),
    ...overrides,
  });
  getEditor.mockReturnValue(ctx);
  return { ctx, wrapper: mount(AgentEditorView, { attachTo: document.body }) };
}

describe("AgentEditorView", () => {
  it("renders the form editor and the preview tab by default", async () => {
    const { wrapper } = mountView();
    await flushPromises();
    expect(wrapper.find("#agent-name").exists()).toBe(true);
    expect(wrapper.get(".panel-header-filename").text()).toBe("reviewer.agent.md");
    expect(
      wrapper.get('[aria-label="Resize definition and prompt"]').attributes("aria-orientation"),
    ).toBe("horizontal");
    expect(wrapper.text()).toContain("reviewer");
  });

  it("swaps the form for the whole file in raw mode", async () => {
    const { ctx, wrapper } = mountView();
    await flushPromises();
    await wrapper.get(".raw-toggle input").setValue(true);
    expect(ctx.rawMode).toBe(true);
    await flushPromises();
    expect(wrapper.find("#agent-name").exists()).toBe(false);
    expect(wrapper.get("textarea").element.value).toContain("name: reviewer");
  });

  it("explains a read-only built-in and points at the override action", async () => {
    const { wrapper } = mountView({
      readOnlyReason: "Installed with the Copilot CLI",
      isReadOnly: true,
      detail: {
        summary: definition("explore", { scope: "builtin" }),
        rawContent: "",
        body: "",
        otherFields: [],
        mcpServers: null,
        diagnostics: [],
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Read-only");
    expect(wrapper.find(".panel-left .banner").exists()).toBe(false);
    expect(wrapper.findAll("button").some((b) => b.text() === "Override")).toBe(true);
    expect(wrapper.findAll("button").some((b) => b.text().includes("Save"))).toBe(false);
  });

  it("prevents switching draft formats while there are unsaved edits", async () => {
    const { wrapper } = mountView({ dirty: true });
    expect(wrapper.get<HTMLInputElement>(".raw-toggle input").element.disabled).toBe(true);
    expect(wrapper.get(".raw-toggle").attributes("title")).toContain("Save or discard");
  });

  it("offers usage but no editor for an agent seen only in sessions", async () => {
    const { wrapper } = mountView({
      detail: null,
      fields: null,
      isSessionOnly: true,
      isReadOnly: true,
      readOnlyReason: "Seen in sessions; no definition file was found.",
      definitionPath: "",
      routeId: "name:ghost-agent",
      agentName: "ghost-agent",
    });
    await flushPromises();
    expect(wrapper.text()).toContain("No definition found");
    expect(wrapper.find("#agent-name").exists()).toBe(false);
    expect(wrapper.find(".raw-toggle").exists()).toBe(false);
  });

  it("disables the override action when settings.json cannot be understood", async () => {
    const { wrapper } = mountView({ canOverride: false });
    await flushPromises();
    const override = wrapper.findAll("button").find((b) => b.text().includes("Override"));
    expect(override!.attributes("disabled")).toBeDefined();
  });
});
