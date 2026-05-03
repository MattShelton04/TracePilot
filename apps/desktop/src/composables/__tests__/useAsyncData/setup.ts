import { afterEach, beforeEach, vi } from "vitest";

export function setupUseAsyncDataTest(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}
