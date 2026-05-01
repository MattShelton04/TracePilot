// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { createDeferred } from "@tracepilot/test-utils";
import { describe, expect, it } from "vitest";
import { FIXTURE_AGENT, FIXTURE_AGENTS, FIXTURE_CONFIG, mocks } from "./setup";
import { useConfigInjectorStore } from "../../../stores/configInjector";

describe("useConfigInjectorStore agent and config mutations", () => {
  describe("selectAgent", () => {
    it("sets selectedAgent and editingYaml", () => {
      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);

      expect(store.selectedAgent).toEqual(FIXTURE_AGENT);
      expect(store.editingYaml).toBe(FIXTURE_AGENT.rawYaml);
    });

    it("preserves rawYaml content for editing", () => {
      const store = useConfigInjectorStore();
      const agentWithComplexYaml = {
        ...FIXTURE_AGENT,
        rawYaml: "name: test\nmodel: opus\ntools:\n  - read\n  - write\n",
      };

      store.selectAgent(agentWithComplexYaml);
      expect(store.editingYaml).toBe(agentWithComplexYaml.rawYaml);
    });
  });

  describe("saveAgent", () => {
    it("successfully saves agent YAML", async () => {
      mocks.saveAgentDefinition.mockResolvedValue(undefined);
      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);

      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);
      store.editingYaml = "name: updated\nmodel: new-model\n";

      const result = await store.saveAgent();

      expect(result).toBe(true);
      expect(mocks.saveAgentDefinition).toHaveBeenCalledWith(
        FIXTURE_AGENT.filePath,
        "name: updated\nmodel: new-model\n",
      );
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Saved code-reviewer agent");
    });

    it("reloads agent definitions after save", async () => {
      mocks.saveAgentDefinition.mockResolvedValue(undefined);
      const updatedAgents = [{ ...FIXTURE_AGENT, model: "new-model" }];
      mocks.getAgentDefinitions.mockResolvedValue(updatedAgents);

      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);

      await store.saveAgent();

      expect(store.agents).toEqual(updatedAgents);
    });

    it("sets error on failure and returns false", async () => {
      mocks.saveAgentDefinition.mockRejectedValue(new Error("Save failed"));

      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);

      const result = await store.saveAgent();

      expect(result).toBe(false);
      expect(store.error).toContain("Save failed");
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it("sets saving=true during operation", async () => {
      const saveDeferred = createDeferred<void>();
      mocks.saveAgentDefinition.mockReturnValue(saveDeferred.promise);
      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);

      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);

      const saveTask = store.saveAgent();
      expect(store.saving).toBe(true);

      saveDeferred.resolve();
      await saveTask;
      expect(store.saving).toBe(false);
    });

    it("returns false when no agent selected", async () => {
      const store = useConfigInjectorStore();
      const result = await store.saveAgent();
      expect(result).toBe(false);
    });
  });

  describe("saveGlobalConfig", () => {
    it("successfully saves global config", async () => {
      mocks.saveCopilotConfig.mockResolvedValue(undefined);
      mocks.getCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);

      const store = useConfigInjectorStore();
      const newConfig = { model: "claude-opus-4.6", reasoningEffort: "medium" };

      const result = await store.saveGlobalConfig(newConfig);

      expect(result).toBe(true);
      expect(mocks.saveCopilotConfig).toHaveBeenCalledWith(newConfig);
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Global config saved");
    });

    it("reloads copilotConfig after save", async () => {
      mocks.saveCopilotConfig.mockResolvedValue(undefined);
      const updatedConfig = { ...FIXTURE_CONFIG, model: "new-model" };
      mocks.getCopilotConfig.mockResolvedValue(updatedConfig);

      const store = useConfigInjectorStore();
      await store.saveGlobalConfig({});

      expect(store.copilotConfig).toEqual(updatedConfig);
    });

    it("sets error on failure", async () => {
      mocks.saveCopilotConfig.mockRejectedValue(new Error("Config save failed"));

      const store = useConfigInjectorStore();
      const result = await store.saveGlobalConfig({});

      expect(result).toBe(false);
      expect(store.error).toContain("Config save failed");
    });

    it("sets saving=true during operation", async () => {
      const saveDeferred = createDeferred<void>();
      mocks.saveCopilotConfig.mockReturnValue(saveDeferred.promise);
      mocks.getCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);

      const store = useConfigInjectorStore();
      const saveTask = store.saveGlobalConfig({});
      expect(store.saving).toBe(true);

      saveDeferred.resolve();
      await saveTask;
      expect(store.saving).toBe(false);
    });
  });
});
