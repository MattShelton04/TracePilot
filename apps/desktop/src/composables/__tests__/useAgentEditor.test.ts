// biome-ignore-all assist/source/organizeImports: mocks must be registered before the composable import.
import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

const mocks = vi.hoisted(() => ({
  agentsGet: vi.fn(),
  agentsSave: vi.fn(),
  agentsSaveRaw: vi.fn(),
  agentsUsageDetail: vi.fn(),
  route: { query: {} as Record<string, string> },
}));

vi.mock("@tracepilot/client", () => ({
  agentsGet: (...args: unknown[]) => mocks.agentsGet(...args),
  agentsSave: (...args: unknown[]) => mocks.agentsSave(...args),
  agentsSaveRaw: (...args: unknown[]) => mocks.agentsSaveRaw(...args),
  agentsUsageDetail: (...args: unknown[]) => mocks.agentsUsageDetail(...args),
}));

vi.mock("vue-router", () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));

const storeMock = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/stores/agents", () => ({ useAgentsStore: () => storeMock.value }));

import { useAgentEditor } from "../useAgentEditor";
import { catalog, definition, fields } from "@/utils/agents/__tests__/fixtures";

function detail(overrides: Record<string, unknown> = {}) {
  const summary = definition("reviewer", {
    fields: fields({ name: "reviewer", models: ["gpt-5.4-mini"] }),
  });
  return {
    summary,
    rawContent: "---\nname: reviewer\n---\nPrompt body",
    body: "Prompt body",
    otherFields: [],
    mcpServers: null,
    diagnostics: [],
    ...overrides,
  };
}

function mountEditor() {
  let ctx!: ReturnType<typeof useAgentEditor>;
  const wrapper = mount(
    defineComponent({
      setup() {
        ctx = useAgentEditor();
        return () => null;
      },
    }),
  );
  return {
    get ctx() {
      return ctx;
    },
    wrapper,
  };
}

describe("useAgentEditor", () => {
  beforeEach(() => {
    setupPinia();
    for (const mock of [
      mocks.agentsGet,
      mocks.agentsSave,
      mocks.agentsSaveRaw,
      mocks.agentsUsageDetail,
    ]) {
      mock.mockReset();
    }
    mocks.route.query = { id: "/defs/reviewer.agent.md" };
    mocks.agentsGet.mockResolvedValue(detail());
    mocks.agentsUsageDetail.mockResolvedValue(null);
    storeMock.value = {
      catalog: catalog([definition("reviewer")]),
      range: "30d",
      loadCatalog: vi.fn(),
      deleteAgent: vi.fn(),
      setOverride: vi.fn(),
      setDisabled: vi.fn(),
    };
  });

  it("loads the definition before querying usage, so usage is keyed by its name", async () => {
    const editor = mountEditor();
    await flushPromises();
    expect(mocks.agentsUsageDetail).toHaveBeenCalledWith("reviewer", {
      fromDate: expect.any(String),
      toDate: expect.any(String),
    });
    expect(editor.ctx.usageError).toBeNull();
    expect(editor.ctx.dirty).toBe(false);
  });

  it("edits a copy of the fields, so the loaded definition is untouched", async () => {
    const editor = mountEditor();
    await flushPromises();
    editor.ctx.patchFields({ models: ["claude-opus-5"] });

    expect(editor.ctx.dirty).toBe(true);
    expect(editor.ctx.detail?.summary.fields.models).toEqual(["gpt-5.4-mini"]);
  });

  it("saves the structured draft, and the whole file in raw mode", async () => {
    mocks.agentsSave.mockResolvedValue({ path: "/defs/reviewer.agent.md", backupPath: "/bak" });
    mocks.agentsSaveRaw.mockResolvedValue({ path: "/defs/reviewer.agent.md", backupPath: null });
    const editor = mountEditor();
    await flushPromises();

    editor.ctx.setBody("New body");
    await editor.ctx.save();
    expect(mocks.agentsSave).toHaveBeenCalledWith(
      "/defs/reviewer.agent.md",
      expect.objectContaining({ name: "reviewer" }),
      "New body",
    );
    expect(editor.ctx.lastBackup).toBe("/bak");
    expect(editor.ctx.dirty).toBe(false);

    editor.ctx.rawMode = true;
    editor.ctx.setRaw("---\nname: reviewer\n---\nRaw");
    await editor.ctx.save();
    expect(mocks.agentsSaveRaw).toHaveBeenCalledWith(
      "/defs/reviewer.agent.md",
      "---\nname: reviewer\n---\nRaw",
    );
  });

  it("refuses to save while a parse error stands", async () => {
    mocks.agentsGet.mockResolvedValue(
      detail({ diagnostics: [{ path: "p", message: "bad yaml", severity: "error" }] }),
    );
    const editor = mountEditor();
    await flushPromises();
    editor.ctx.setBody("x");

    expect(editor.ctx.canSave).toBe(false);
    await editor.ctx.save();
    expect(mocks.agentsSave).not.toHaveBeenCalled();
  });

  it("ignores edits to a read-only definition", async () => {
    mocks.agentsGet.mockResolvedValue(
      detail({
        summary: definition("explore", {
          scope: "builtin",
          readOnlyReason: "Installed with the Copilot CLI",
        }),
      }),
    );
    const editor = mountEditor();
    await flushPromises();

    editor.ctx.setBody("nope");
    editor.ctx.patchFields({ models: ["x"] });
    expect(editor.ctx.dirty).toBe(false);
    expect(editor.ctx.isReadOnly).toBe(true);
  });

  it("shows a session-only agent's usage without asking for a definition", async () => {
    mocks.route.query = { id: "name:ghost-agent" };
    const editor = mountEditor();
    await flushPromises();

    expect(mocks.agentsGet).not.toHaveBeenCalled();
    expect(mocks.agentsUsageDetail).toHaveBeenCalledWith("ghost-agent", expect.anything());
    expect(editor.ctx.isSessionOnly).toBe(true);
    expect(editor.ctx.readOnlyReason).toContain("no definition file");
  });

  it("surfaces a load failure instead of rendering an empty editor", async () => {
    mocks.agentsGet.mockRejectedValue(new Error("file vanished"));
    const editor = mountEditor();
    await flushPromises();

    expect(editor.ctx.error).toContain("file vanished");
    expect(editor.ctx.fields).toBeNull();
  });
});
