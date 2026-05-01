// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { createDeferred } from "@tracepilot/test-utils";
import type { ModelInfo, SessionTemplate, SystemDependencies } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { MOCK_DEPS, MOCK_MODELS, MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS, mocks } from "./setup";
import { useLauncherStore } from "../../../stores/launcher";

describe("useLauncherStore", () => {
  it("initializes with empty state", () => {
    const store = useLauncherStore();
    expect(store.models).toEqual([]);
    expect(store.templates).toEqual([]);
    expect(store.recentLaunches).toEqual([]);
    expect(store.systemDeps).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  describe("initialize", () => {
    it("loads models, templates, and system deps", async () => {
      mocks.checkSystemDeps.mockResolvedValue(MOCK_DEPS);
      mocks.getAvailableModels.mockResolvedValue(MOCK_MODELS);
      mocks.listSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.systemDeps).toEqual(MOCK_DEPS);
      expect(store.models).toEqual(MOCK_MODELS);
      expect(store.templates).toHaveLength(2);
      expect(store.templates[0].icon).toBe("🔍");
      expect(store.templates[1].icon).toBe("🧪");
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("sets error when some requests fail", async () => {
      mocks.checkSystemDeps.mockResolvedValue(MOCK_DEPS);
      mocks.getAvailableModels.mockRejectedValue(new Error("Network error"));
      mocks.listSessionTemplates.mockResolvedValue([MOCK_TEMPLATE]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.systemDeps).toEqual(MOCK_DEPS);
      expect(store.models).toEqual([]); // failed
      expect(store.templates).toHaveLength(1); // succeeded
      expect(store.error).toContain("Network error");
    });

    it("ignores stale initialize responses when a newer call finishes first", async () => {
      const staleDeps = createDeferred<SystemDependencies>();
      const staleModels = createDeferred<ModelInfo[]>();
      const staleTemplates = createDeferred<SessionTemplate[]>();

      const freshDeps: SystemDependencies = {
        ...MOCK_DEPS,
        gitVersion: "2.46.0",
      };
      const freshModels: ModelInfo[] = [{ id: "gpt-5.4", name: "GPT-5.4", tier: "premium" }];
      const freshTemplates: SessionTemplate[] = [{ ...MOCK_TEMPLATE, id: "fresh-template" }];

      mocks.checkSystemDeps.mockReturnValueOnce(staleDeps.promise).mockResolvedValueOnce(freshDeps);
      mocks.getAvailableModels
        .mockReturnValueOnce(staleModels.promise)
        .mockResolvedValueOnce(freshModels);
      mocks.listSessionTemplates
        .mockReturnValueOnce(staleTemplates.promise)
        .mockResolvedValueOnce(freshTemplates);

      const store = useLauncherStore();
      const first = store.initialize();
      const second = store.initialize();

      await second;

      expect(store.systemDeps).toEqual(freshDeps);
      expect(store.models).toEqual(freshModels);
      expect(store.templates).toEqual(freshTemplates);
      expect(store.error).toBeNull();
      expect(store.loading).toBe(false);

      staleDeps.resolve(MOCK_DEPS);
      staleModels.resolve(MOCK_MODELS);
      staleTemplates.resolve([MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS]);
      await first;

      expect(store.systemDeps).toEqual(freshDeps);
      expect(store.models).toEqual(freshModels);
      expect(store.templates).toEqual(freshTemplates);
      expect(store.error).toBeNull();
      expect(store.loading).toBe(false);
    });

    it("keeps loading true while newer initialize is still pending", async () => {
      const staleDeps = createDeferred<SystemDependencies>();
      const staleModels = createDeferred<ModelInfo[]>();
      const staleTemplates = createDeferred<SessionTemplate[]>();
      const freshDeps = createDeferred<SystemDependencies>();
      const freshModels = createDeferred<ModelInfo[]>();
      const freshTemplates = createDeferred<SessionTemplate[]>();

      mocks.checkSystemDeps
        .mockReturnValueOnce(staleDeps.promise)
        .mockReturnValueOnce(freshDeps.promise);
      mocks.getAvailableModels
        .mockReturnValueOnce(staleModels.promise)
        .mockReturnValueOnce(freshModels.promise);
      mocks.listSessionTemplates
        .mockReturnValueOnce(staleTemplates.promise)
        .mockReturnValueOnce(freshTemplates.promise);

      const store = useLauncherStore();
      const first = store.initialize();
      const second = store.initialize();

      expect(store.loading).toBe(true);

      staleDeps.resolve(MOCK_DEPS);
      staleModels.resolve(MOCK_MODELS);
      staleTemplates.resolve([MOCK_TEMPLATE]);
      await first;

      expect(store.loading).toBe(true);
      expect(store.systemDeps).toBeNull();
      expect(store.models).toEqual([]);
      expect(store.templates).toEqual([]);

      freshDeps.resolve({ ...MOCK_DEPS, gitVersion: "2.47.0" });
      freshModels.resolve([{ id: "gpt-5.2", name: "GPT-5.2", tier: "standard" }]);
      freshTemplates.resolve([{ ...MOCK_TEMPLATE_WRITE_TESTS, id: "fresh-pending" }]);
      await second;

      expect(store.loading).toBe(false);
      expect(store.systemDeps?.gitVersion).toBe("2.47.0");
      expect(store.models).toEqual([{ id: "gpt-5.2", name: "GPT-5.2", tier: "standard" }]);
      expect(store.templates).toEqual([{ ...MOCK_TEMPLATE_WRITE_TESTS, id: "fresh-pending" }]);
      expect(store.error).toBeNull();
    });

    it("ignores stale initialize errors after a newer successful initialize", async () => {
      const staleDeps = createDeferred<SystemDependencies>();

      const freshDeps: SystemDependencies = {
        ...MOCK_DEPS,
        copilotVersion: "1.1.0",
      };
      const freshModels: ModelInfo[] = [
        { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", tier: "standard" },
      ];
      const freshTemplates: SessionTemplate[] = [
        { ...MOCK_TEMPLATE_WRITE_TESTS, id: "fresh-write-tests" },
      ];

      mocks.checkSystemDeps.mockReturnValueOnce(staleDeps.promise).mockResolvedValueOnce(freshDeps);
      mocks.getAvailableModels
        .mockResolvedValueOnce(MOCK_MODELS)
        .mockResolvedValueOnce(freshModels);
      mocks.listSessionTemplates
        .mockResolvedValueOnce([MOCK_TEMPLATE])
        .mockResolvedValueOnce(freshTemplates);

      const store = useLauncherStore();
      const first = store.initialize();
      const second = store.initialize();

      await second;

      expect(store.systemDeps).toEqual(freshDeps);
      expect(store.models).toEqual(freshModels);
      expect(store.templates).toEqual(freshTemplates);
      expect(store.error).toBeNull();
      expect(store.loading).toBe(false);

      staleDeps.reject(new Error("stale deps failed"));
      await first;

      expect(store.systemDeps).toEqual(freshDeps);
      expect(store.models).toEqual(freshModels);
      expect(store.templates).toEqual(freshTemplates);
      expect(store.error).toBeNull();
      expect(store.loading).toBe(false);
    });
  });
});
