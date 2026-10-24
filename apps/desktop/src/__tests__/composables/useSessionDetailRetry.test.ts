// biome-ignore-all assist/source/organizeImports: setup must register mocks before the composable import.
import { describe, expect, it } from "vitest";
import {
  createDeferred,
  FIXTURE_DETAIL,
  FIXTURE_INCIDENTS,
  SESSION_ID,
  mocks,
  setupSessionDetailStoreTest,
} from "../stores/sessionDetail/setup";
import { createSessionDetailInstance } from "@/composables/useSessionDetail";

setupSessionDetailStoreTest();

// Retrying a session detail whose first load failed.
describe("createSessionDetailInstance retryDetail", () => {
  it("loads the detail and keeps the sections that already loaded", async () => {
    mocks.getSessionDetail.mockRejectedValueOnce(new Error("busy"));
    const sd = createSessionDetailInstance();
    await sd.loadDetail(SESSION_ID);
    await sd.loadIncidents();
    expect(sd.error.value).toBe("busy");

    await sd.retryDetail();

    expect(sd.error.value).toBeNull();
    expect(sd.loading.value).toBe(false);
    expect(sd.detail.value).toEqual(FIXTURE_DETAIL);
    expect(sd.loaded.value.has("detail")).toBe(true);
    expect(sd.incidents.value).toEqual(FIXTURE_INCIDENTS);
  });

  it("drops a late retry once another session opened", async () => {
    mocks.getSessionDetail.mockRejectedValueOnce(new Error("busy"));
    const sd = createSessionDetailInstance();
    await sd.loadDetail(SESSION_ID);

    const late = createDeferred<typeof FIXTURE_DETAIL>();
    mocks.getSessionDetail.mockReturnValueOnce(late.promise);
    const retry = sd.retryDetail();
    const other = { ...FIXTURE_DETAIL, id: "other-id" };
    mocks.getSessionDetail.mockResolvedValueOnce(other);
    await sd.loadDetail("other-id");
    late.resolve(FIXTURE_DETAIL);
    await retry;

    expect(sd.sessionId.value).toBe("other-id");
    expect(sd.detail.value).toEqual(other);
    expect(sd.error.value).toBeNull();
  });

  it("is retried by a refresh, which leaves a loaded detail to its own refresh", async () => {
    mocks.getSessionDetail.mockRejectedValueOnce(new Error("busy"));
    const sd = createSessionDetailInstance();
    await sd.loadDetail(SESSION_ID);

    mocks.getSessionDetail.mockRejectedValueOnce(new Error("still busy"));
    await sd.refreshIfSourceChanged();
    expect(sd.error.value).toBe("still busy");
    expect(sd.loaded.value.has("detail")).toBe(false);

    await sd.refreshAll();
    expect(sd.error.value).toBeNull();
    expect(sd.detail.value).toEqual(FIXTURE_DETAIL);
    expect(mocks.getSessionDetail).toHaveBeenCalledTimes(3);
  });
});
