import { describe, expect, it } from "vitest";
import { createAlertsSlice } from "../alerts";

describe("createAlertsSlice", () => {
  it("defaults to disabled with monitored scope", () => {
    const slice = createAlertsSlice();
    expect(slice.alertsEnabled.value).toBe(false);
    expect(slice.alertsScope.value).toBe("monitored");
  });

  it("preserves per-event defaults matching the legacy store", () => {
    const slice = createAlertsSlice();
    expect(slice.alertsNativeNotifications.value).toBe(true);
    expect(slice.alertsTaskbarFlash.value).toBe(true);
    expect(slice.alertsSoundEnabled.value).toBe(false);
    expect(slice.alertsOnAskUser.value).toBe(true);
    expect(slice.alertsOnSessionError.value).toBe(false);
    expect(slice.alertsCooldownSeconds.value).toBe(20);
  });

  it("refs are mutable and retain their new values", () => {
    const slice = createAlertsSlice();
    slice.alertsEnabled.value = true;
    slice.alertsScope.value = "all";
    slice.alertsCooldownSeconds.value = 45;
    expect(slice.alertsEnabled.value).toBe(true);
    expect(slice.alertsScope.value).toBe("all");
    expect(slice.alertsCooldownSeconds.value).toBe(45);
  });
});
