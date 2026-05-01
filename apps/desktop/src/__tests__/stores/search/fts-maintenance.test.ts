// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { mocks, resetAllMocks, setupDefaultMocks } from "./setup";
import { useSearchStore } from "../../../stores/search";

describe("useSearchStore FTS maintenance", () => {
  beforeEach(() => {
    setupPinia();
    resetAllMocks();
    setupDefaultMocks();
  });

  // ── runIntegrityCheck ──────────────────────────────────────────

  it("runIntegrityCheck sets maintenanceMessage on success", async () => {
    mocks.ftsIntegrityCheck.mockResolvedValue("integrity_check: 1 row(s) ok");
    const store = useSearchStore();
    await store.runIntegrityCheck();
    expect(store.maintenanceMessage).toBe("integrity_check: 1 row(s) ok");
  });

  it("runIntegrityCheck clears maintenanceMessage before running", async () => {
    const store = useSearchStore();
    store.maintenanceMessage = "previous message";
    mocks.ftsIntegrityCheck.mockResolvedValue("ok");
    await store.runIntegrityCheck();
    expect(store.maintenanceMessage).toBe("ok");
  });

  it("runIntegrityCheck sets Error-prefixed message using toErrorMessage on failure", async () => {
    mocks.ftsIntegrityCheck.mockRejectedValue(new Error("index corrupted"));
    const store = useSearchStore();
    await store.runIntegrityCheck();
    // toErrorMessage(new Error("index corrupted")) = "index corrupted"
    expect(store.maintenanceMessage).toBe("Error: index corrupted");
  });

  it("runIntegrityCheck handles non-Error thrown values without [object Object]", async () => {
    mocks.ftsIntegrityCheck.mockRejectedValue({ message: "constraint violation" });
    const store = useSearchStore();
    await store.runIntegrityCheck();
    // toErrorMessage extracts the .message property from thrown objects
    expect(store.maintenanceMessage).toBe("Error: constraint violation");
    expect(store.maintenanceMessage).not.toContain("[object Object]");
  });

  // ── runOptimize ────────────────────────────────────────────────

  it("runOptimize sets maintenanceMessage on success", async () => {
    mocks.ftsOptimize.mockResolvedValue("optimize complete");
    const store = useSearchStore();
    await store.runOptimize();
    expect(store.maintenanceMessage).toBe("optimize complete");
  });

  it("runOptimize refreshes health info after a successful run", async () => {
    mocks.ftsOptimize.mockResolvedValue("done");
    mocks.ftsHealth.mockResolvedValue({
      inSync: true,
      indexedSessions: 5,
      totalSessions: 5,
      totalContentRows: 100,
      pendingSessions: 0,
      dbSizeBytes: 1024,
    });
    const store = useSearchStore();
    await store.runOptimize();
    expect(mocks.ftsHealth).toHaveBeenCalledTimes(1);
  });

  it("runOptimize sets Error-prefixed message using toErrorMessage on failure", async () => {
    mocks.ftsOptimize.mockRejectedValue(new Error("write lock held"));
    const store = useSearchStore();
    await store.runOptimize();
    // toErrorMessage(new Error("write lock held")) = "write lock held"
    expect(store.maintenanceMessage).toBe("Error: write lock held");
  });

  it("runOptimize does not refresh health when optimize fails", async () => {
    mocks.ftsOptimize.mockRejectedValue(new Error("failed"));
    const store = useSearchStore();
    await store.runOptimize();
    expect(mocks.ftsHealth).not.toHaveBeenCalled();
  });

  it("runOptimize handles non-Error thrown values without [object Object]", async () => {
    mocks.ftsOptimize.mockRejectedValue({ message: "database busy" });
    const store = useSearchStore();
    await store.runOptimize();
    expect(store.maintenanceMessage).toBe("Error: database busy");
    expect(store.maintenanceMessage).not.toContain("[object Object]");
  });

  it("runIntegrityCheck handles null rejection with fallback message", async () => {
    mocks.ftsIntegrityCheck.mockRejectedValue(null);
    const store = useSearchStore();
    await store.runIntegrityCheck();
    // toErrorMessage(null) = "Unknown error"
    expect(store.maintenanceMessage).toBe("Error: Unknown error");
  });

  it("runOptimize handles thrown string values", async () => {
    mocks.ftsOptimize.mockRejectedValue("permission denied");
    const store = useSearchStore();
    await store.runOptimize();
    // toErrorMessage("permission denied") = "permission denied" (String fallback)
    expect(store.maintenanceMessage).toBe("Error: permission denied");
  });
});
