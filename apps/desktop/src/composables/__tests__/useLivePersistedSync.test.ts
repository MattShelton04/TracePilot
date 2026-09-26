import type { BridgeEvent } from "@tracepilot/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

const handlers = new Set<(event: BridgeEvent) => void>();
const sdkMock = {
  onBridgeEvent: vi.fn((handler: (event: BridgeEvent) => void) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  }),
};
vi.mock("@/stores/sdk", () => ({ useSdkStore: () => sdkMock }));

import {
  LIVE_REFRESH_DEBOUNCE_MS,
  LIVE_REFRESH_MAX_WAIT_MS,
  useLivePersistedSync,
} from "../useLivePersistedSync";

function emit(eventType: string, sessionId = "s1") {
  const event: BridgeEvent = {
    sessionId,
    eventType,
    timestamp: "2026-09-26T00:00:00Z",
    id: null,
    parentId: null,
    ephemeral: false,
    data: {},
  };
  for (const handler of handlers) handler(event);
}

function setup(sessionId = "s1") {
  const refresh = vi.fn();
  const scope = effectScope();
  scope.run(() => useLivePersistedSync({ sessionId: () => sessionId, refresh }));
  return { refresh, scope };
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLivePersistedSync", () => {
  it("holds refreshes while disabled and catches up once when re-enabled", async () => {
    const refresh = vi.fn();
    const visible = ref(false);
    const scope = effectScope();
    scope.run(() =>
      useLivePersistedSync({ sessionId: () => "s1", refresh, enabled: () => visible.value }),
    );
    emit("assistant.message");
    emit("session.idle");
    vi.advanceTimersByTime(LIVE_REFRESH_MAX_WAIT_MS);
    expect(refresh).not.toHaveBeenCalled();

    visible.value = true;
    await nextTick();
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("refreshes once after a burst of durable events", () => {
    const { refresh } = setup();
    emit("tool.execution_start");
    emit("tool.execution_start");
    emit("tool.execution_complete");
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores ephemeral events and other sessions", () => {
    const { refresh } = setup();
    emit("assistant.message_delta");
    emit("tool.execution_partial_result");
    emit("assistant.message", "other");
    vi.advanceTimersByTime(LIVE_REFRESH_MAX_WAIT_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("caps staleness while events keep arriving", () => {
    const { refresh } = setup();
    const step = LIVE_REFRESH_DEBOUNCE_MS / 2;
    for (let t = 0; t < LIVE_REFRESH_MAX_WAIT_MS; t += step) {
      emit("assistant.message");
      vi.advanceTimersByTime(step);
    }
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes and cancels a pending refresh on dispose", () => {
    const { refresh, scope } = setup();
    emit("user.message");
    scope.stop();
    vi.advanceTimersByTime(LIVE_REFRESH_MAX_WAIT_MS);
    expect(refresh).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
  });
});
