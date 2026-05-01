// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import type { SessionTemplate } from "@tracepilot/types";
import { MOCK_DEPS, MOCK_MODELS, MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS, mocks } from "./setup";
import { useLauncherStore } from "../../../stores/launcher";

describe("useLauncherStore", () => {
  describe("isReady", () => {
    it("returns false when system deps not loaded", () => {
      const store = useLauncherStore();
      expect(store.isReady).toBeFalsy();
    });

    it("returns true when git and copilot available", async () => {
      mocks.checkSystemDeps.mockResolvedValue(MOCK_DEPS);
      mocks.getAvailableModels.mockResolvedValue([]);
      mocks.listSessionTemplates.mockResolvedValue([]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.isReady).toBe(true);
    });

    it("returns false when git not available", async () => {
      mocks.checkSystemDeps.mockResolvedValue({ ...MOCK_DEPS, gitAvailable: false });
      mocks.getAvailableModels.mockResolvedValue([]);
      mocks.listSessionTemplates.mockResolvedValue([]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.isReady).toBeFalsy();
    });
  });

  describe("modelsByTier", () => {
    it("groups models by tier", async () => {
      mocks.checkSystemDeps.mockResolvedValue(MOCK_DEPS);
      mocks.getAvailableModels.mockResolvedValue(MOCK_MODELS);
      mocks.listSessionTemplates.mockResolvedValue([]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.modelsByTier).toEqual({
        premium: [{ id: "claude-opus-4.6", name: "Claude Opus 4.6", tier: "premium" }],
        standard: [{ id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", tier: "standard" }],
        fast: [{ id: "claude-haiku-4.5", name: "Claude Haiku 4.5", tier: "fast" }],
      });
    });
  });

  describe("templates", () => {
    it("default templates have icon field", async () => {
      mocks.checkSystemDeps.mockResolvedValue(MOCK_DEPS);
      mocks.getAvailableModels.mockResolvedValue([]);
      mocks.listSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS]);

      const store = useLauncherStore();
      await store.initialize();

      for (const tpl of store.templates) {
        expect(tpl.icon).toBeDefined();
        expect(typeof tpl.icon).toBe("string");
      }
    });

    it("multi-agent review template has correct config", async () => {
      mocks.checkSystemDeps.mockResolvedValue(MOCK_DEPS);
      mocks.getAvailableModels.mockResolvedValue([]);
      mocks.listSessionTemplates.mockResolvedValue([MOCK_TEMPLATE]);

      const store = useLauncherStore();
      await store.initialize();

      const tpl = store.templates.find((t) => t.id === "default-multi-agent-review");
      expect(tpl).toBeDefined();
      expect(tpl?.config.model).toBe("claude-opus-4.6");
      expect(tpl?.config.reasoningEffort).toBe("high");
      expect(tpl?.config.prompt).toContain("Spin up opus 4.6");
      expect(tpl?.icon).toBe("🔍");
    });

    it("write tests template has correct config", async () => {
      mocks.checkSystemDeps.mockResolvedValue(MOCK_DEPS);
      mocks.getAvailableModels.mockResolvedValue([]);
      mocks.listSessionTemplates.mockResolvedValue([MOCK_TEMPLATE_WRITE_TESTS]);

      const store = useLauncherStore();
      await store.initialize();

      const tpl = store.templates.find((t) => t.id === "default-write-tests");
      expect(tpl).toBeDefined();
      expect(tpl?.config.model).toBe("claude-sonnet-4.6");
      expect(tpl?.config.reasoningEffort).toBe("high");
      expect(tpl?.config.createWorktree).toBe(false);
      expect(tpl?.config.autoApprove).toBe(false);
      expect(tpl?.icon).toBe("🧪");
    });
  });

  describe("saveTemplate", () => {
    it("saves template and refreshes list", async () => {
      const savedTemplate: SessionTemplate = {
        ...MOCK_TEMPLATE,
        id: "user-custom-1",
        name: "Custom Template",
        icon: "⭐",
      };

      mocks.saveSessionTemplate.mockResolvedValue(undefined);
      mocks.listSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, savedTemplate]);

      const store = useLauncherStore();
      const result = await store.saveTemplate(savedTemplate);

      expect(result).toBe(true);
      expect(mocks.saveSessionTemplate).toHaveBeenCalledWith(savedTemplate);
      expect(mocks.listSessionTemplates).toHaveBeenCalled();
      expect(store.templates).toHaveLength(2);
    });

    it("returns false and sets error on failure", async () => {
      mocks.saveSessionTemplate.mockRejectedValue(new Error("Save failed"));

      const store = useLauncherStore();
      const result = await store.saveTemplate(MOCK_TEMPLATE);

      expect(result).toBe(false);
      expect(store.error).toContain("Save failed");
    });
  });

  describe("deleteTemplate", () => {
    it("removes template from store", async () => {
      mocks.checkSystemDeps.mockResolvedValue(MOCK_DEPS);
      mocks.getAvailableModels.mockResolvedValue([]);
      mocks.listSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS]);
      mocks.deleteSessionTemplate.mockResolvedValue(undefined);

      const store = useLauncherStore();
      await store.initialize();
      expect(store.templates).toHaveLength(2);

      const result = await store.deleteTemplate("default-write-tests");
      expect(result).toBe(true);
      expect(mocks.deleteSessionTemplate).toHaveBeenCalledWith("default-write-tests");
      expect(store.templates).toHaveLength(1);
      expect(store.templates[0].id).toBe("default-multi-agent-review");
    });

    it("can delete default templates (dismiss)", async () => {
      mocks.checkSystemDeps.mockResolvedValue(MOCK_DEPS);
      mocks.getAvailableModels.mockResolvedValue([]);
      mocks.listSessionTemplates.mockResolvedValue([MOCK_TEMPLATE]);
      mocks.deleteSessionTemplate.mockResolvedValue(undefined);

      const store = useLauncherStore();
      await store.initialize();

      const result = await store.deleteTemplate("default-multi-agent-review");
      expect(result).toBe(true);
      expect(store.templates).toHaveLength(0);
    });

    it("returns false and sets error on failure", async () => {
      mocks.deleteSessionTemplate.mockRejectedValue(new Error("Delete failed"));

      const store = useLauncherStore();
      store.templates = [MOCK_TEMPLATE];
      const result = await store.deleteTemplate("default-multi-agent-review");

      expect(result).toBe(false);
      expect(store.error).toContain("Delete failed");
    });
  });
});
