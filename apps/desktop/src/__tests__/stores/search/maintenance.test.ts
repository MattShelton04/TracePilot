import { effectScope } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMaintenanceSlice } from "../../../stores/search/maintenance";

const mockFtsHealth = vi.fn();
const mockFtsIntegrityCheck = vi.fn();
const mockFtsOptimize = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    ftsHealth: (...args: unknown[]) => mockFtsHealth(...args),
    ftsIntegrityCheck: (...args: unknown[]) => mockFtsIntegrityCheck(...args),
    ftsOptimize: (...args: unknown[]) => mockFtsOptimize(...args),
  });
});

function setup() {
  const scope = effectScope();
  const m = scope.run(() => createMaintenanceSlice()) as ReturnType<typeof createMaintenanceSlice>;
  return { m, dispose: () => scope.stop() };
}

describe("search/maintenance slice", () => {
  beforeEach(() => {
    mockFtsHealth.mockReset();
    mockFtsIntegrityCheck.mockReset();
    mockFtsOptimize.mockReset();
  });

  it("fetchHealth stores health info and toggles loading", async () => {
    const info = { ok: true, totals: { content: 10, docs: 5 } };
    mockFtsHealth.mockResolvedValue(info);
    const { m, dispose } = setup();
    try {
      const p = m.fetchHealth();
      expect(m.healthLoading.value).toBe(true);
      await p;
      expect(m.healthLoading.value).toBe(false);
      expect(m.healthInfo.value).toEqual(info);
    } finally {
      dispose();
    }
  });

  it("fetchHealth nulls healthInfo and keeps loading false on error", async () => {
    mockFtsHealth.mockRejectedValue(new Error("boom"));
    const { m, dispose } = setup();
    try {
      m.healthInfo.value = { ok: true } as never;
      await m.fetchHealth();
      expect(m.healthInfo.value).toBeNull();
      expect(m.healthLoading.value).toBe(false);
    } finally {
      dispose();
    }
  });

  it("runIntegrityCheck stores success message and 'Error: <msg>' on failure", async () => {
    const { m, dispose } = setup();
    try {
      mockFtsIntegrityCheck.mockResolvedValueOnce("ok");
      await m.runIntegrityCheck();
      expect(m.maintenanceMessage.value).toBe("ok");

      mockFtsIntegrityCheck.mockRejectedValueOnce(new Error("corrupt"));
      await m.runIntegrityCheck();
      expect(m.maintenanceMessage.value).toContain("Error:");
      expect(m.maintenanceMessage.value).toContain("corrupt");
    } finally {
      dispose();
    }
  });

  it("runOptimize refreshes health after success", async () => {
    mockFtsOptimize.mockResolvedValue("optimized");
    const healthInfo = { ok: true };
    mockFtsHealth.mockResolvedValue(healthInfo);
    const { m, dispose } = setup();
    try {
      await m.runOptimize();
      expect(m.maintenanceMessage.value).toBe("optimized");
      expect(mockFtsHealth).toHaveBeenCalledTimes(1);
      expect(m.healthInfo.value).toEqual(healthInfo);
    } finally {
      dispose();
    }
  });
});
