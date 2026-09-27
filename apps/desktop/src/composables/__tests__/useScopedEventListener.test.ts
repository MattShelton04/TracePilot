import type { Event, UnlistenFn } from "@tauri-apps/api/event";
import { createDeferred } from "@tracepilot/test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { safeListen } from "@/utils/tauriEvents";
import { useScopedEventListener } from "../useScopedEventListener";

vi.mock("@/utils/tauriEvents", () => ({ safeListen: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it("shares pending registration and immediately removes it after scope disposal", async () => {
  const registration = createDeferred<UnlistenFn>();
  vi.mocked(safeListen).mockReturnValue(registration.promise);
  const handler = vi.fn();
  const unlisten = vi.fn();
  const scope = effectScope();
  const setup = scope.run(() => useScopedEventListener("progress", handler))!;
  const first = setup();
  const second = setup();
  expect(safeListen).toHaveBeenCalledOnce();
  scope.stop();
  registration.resolve(unlisten);
  await Promise.all([first, second]);
  expect(unlisten).toHaveBeenCalledOnce();
  vi.mocked(safeListen).mock.calls[0]![1]({ payload: "late" } as Event<unknown>);
  expect(handler).not.toHaveBeenCalled();
  await setup();
  expect(safeListen).toHaveBeenCalledOnce();
});

it("retries failed registrations and disposes established listeners once", async () => {
  const stop = vi.fn();
  vi.mocked(safeListen)
    .mockRejectedValueOnce(new Error("registration failed"))
    .mockResolvedValue(stop);
  const scope = effectScope();
  const setup = scope.run(() => useScopedEventListener("progress", vi.fn()))!;
  await expect(setup()).rejects.toThrow("registration failed");
  await setup();
  await setup();
  expect(safeListen).toHaveBeenCalledTimes(2);
  scope.stop();
  expect(stop).toHaveBeenCalledOnce();
});
