// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import { MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS, mocks } from "./setup";
import { useLauncherStore } from "../../../stores/launcher";

describe("useLauncherStore", () => {
  describe("launch", () => {
    it("launches session and tracks in recent launches", async () => {
      const mockSession = {
        pid: 12345,
        command: "copilot --model=claude-opus-4.6",
        launchedAt: "2025-01-01T00:00:00Z",
        launchMode: "terminal",
      };
      mocks.launchSession.mockResolvedValue(mockSession);

      const store = useLauncherStore();
      const result = await store.launch({
        repoPath: "C:\\git\\test",
        headless: false,
        envVars: {},
        createWorktree: false,
        autoApprove: false,
      });

      expect(result).toEqual(mockSession);
      expect(store.recentLaunches).toHaveLength(1);
      expect(store.recentLaunches[0].pid).toBe(12345);
    });

    it("caps recent launches at 10", async () => {
      const store = useLauncherStore();
      store.recentLaunches = Array.from({ length: 10 }, (_, i) => ({
        pid: i,
        command: `cmd-${i}`,
        launchedAt: "2025-01-01T00:00:00Z",
        launchMode: "terminal" as const,
      }));

      const mockSession = {
        pid: 99,
        command: "copilot",
        launchedAt: "2025-01-01T00:00:00Z",
        launchMode: "terminal",
      };
      mocks.launchSession.mockResolvedValue(mockSession);

      await store.launch({
        repoPath: "C:\\git\\test",
        headless: false,
        envVars: {},
        createWorktree: false,
        autoApprove: false,
      });

      expect(store.recentLaunches).toHaveLength(10);
      expect(store.recentLaunches[0].pid).toBe(99);
    });

    it("returns null and sets error on failure", async () => {
      mocks.launchSession.mockRejectedValue(new Error("Launch failed"));

      const store = useLauncherStore();
      const result = await store.launch({
        repoPath: "C:\\git\\test",
        headless: false,
        envVars: {},
        createWorktree: false,
        autoApprove: false,
      });

      expect(result).toBeNull();
      expect(store.error).toContain("Launch failed");
    });
  });

  describe("restoreDefaults", () => {
    it("calls restore API and refreshes templates", async () => {
      mocks.restoreDefaultTemplates.mockResolvedValue(undefined);
      mocks.listSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS]);

      const store = useLauncherStore();
      store.templates = []; // all dismissed

      const result = await store.restoreDefaults();

      expect(result).toBe(true);
      expect(mocks.restoreDefaultTemplates).toHaveBeenCalled();
      expect(mocks.listSessionTemplates).toHaveBeenCalled();
      expect(store.templates).toHaveLength(2);
    });

    it("returns false and sets error on failure", async () => {
      mocks.restoreDefaultTemplates.mockRejectedValue(new Error("Restore failed"));

      const store = useLauncherStore();
      const result = await store.restoreDefaults();

      expect(result).toBe(false);
      expect(store.error).toContain("Restore failed");
    });
  });

  describe("incrementUsage", () => {
    it("increments usage count optimistically", async () => {
      mocks.incrementTemplateUsage.mockResolvedValue(undefined);

      const store = useLauncherStore();
      store.templates = [{ ...MOCK_TEMPLATE, usageCount: 3 }];

      await store.incrementUsage("default-multi-agent-review");

      expect(mocks.incrementTemplateUsage).toHaveBeenCalledWith("default-multi-agent-review");
      expect(store.templates[0].usageCount).toBe(4);
    });

    it("does not surface errors for usage tracking", async () => {
      mocks.incrementTemplateUsage.mockRejectedValue(new Error("Tracking failed"));

      const store = useLauncherStore();
      store.templates = [{ ...MOCK_TEMPLATE, usageCount: 0 }];

      await store.incrementUsage("default-multi-agent-review");

      // Error should NOT be set — usage tracking is non-critical
      expect(store.error).toBeNull();
      expect(mocks.logWarn).toHaveBeenCalledWith(
        "[launcher] Failed to increment template usage",
        expect.objectContaining({ id: "default-multi-agent-review" }),
      );
    });
  });
});
