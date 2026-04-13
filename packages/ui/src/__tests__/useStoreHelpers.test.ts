import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { runAction, runMutation } from "../composables/useStoreHelpers";

describe("runAction", () => {
  it("sets loading, calls action, invokes onSuccess", async () => {
    const loading = ref(false);
    const error = ref<string | null>(null);
    const data = ref<string | null>(null);

    await runAction({
      loading,
      error,
      action: async () => "result",
      onSuccess: (r) => {
        data.value = r;
      },
    });

    expect(data.value).toBe("result");
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("sets error on failure", async () => {
    const loading = ref(false);
    const error = ref<string | null>(null);
    const data = ref<string | null>(null);

    await runAction({
      loading,
      error,
      action: async () => {
        throw new Error("boom");
      },
      onSuccess: (r) => {
        data.value = r;
      },
    });

    expect(data.value).toBeNull();
    expect(loading.value).toBe(false);
    expect(error.value).toBe("boom");
  });

  it("skips stale results when guard invalidates", async () => {
    const loading = ref(false);
    const error = ref<string | null>(null);
    const data = ref<string | null>(null);

    let generation = 0;
    const guard = {
      start: () => ++generation,
      isValid: (token: number) => token === generation,
    };

    // Start first action that will be superseded
    const first = runAction({
      loading,
      error,
      guard,
      action: async () => {
        // Simulate slow request — guard will be invalidated before resolve
        return "stale";
      },
      onSuccess: (r) => {
        data.value = r;
      },
    });

    // Invalidate by starting another generation
    guard.start();

    await first;

    // Stale result should be ignored
    expect(data.value).toBeNull();
  });

  it("sets loading=true during execution", async () => {
    const loading = ref(false);
    const error = ref<string | null>(null);
    let loadingDuringAction = false;

    await runAction({
      loading,
      error,
      action: async () => {
        loadingDuringAction = loading.value;
        return "ok";
      },
      onSuccess: () => {},
    });

    expect(loadingDuringAction).toBe(true);
    expect(loading.value).toBe(false);
  });

  it("clears previous error before executing", async () => {
    const loading = ref(false);
    const error = ref<string | null>("old error");

    await runAction({
      loading,
      error,
      action: async () => "ok",
      onSuccess: () => {},
    });

    expect(error.value).toBeNull();
  });

  it("works without guard", async () => {
    const loading = ref(false);
    const error = ref<string | null>(null);
    const data = ref<number>(0);

    await runAction({
      loading,
      error,
      action: async () => 42,
      onSuccess: (r) => {
        data.value = r;
      },
    });

    expect(data.value).toBe(42);
  });
});

describe("runMutation", () => {
  it("returns action result on success", async () => {
    const error = ref<string | null>(null);

    const result = await runMutation(error, async () => "created-id");

    expect(result).toBe("created-id");
    expect(error.value).toBeNull();
  });

  it("returns null and sets error on failure", async () => {
    const error = ref<string | null>(null);

    const result = await runMutation(error, async () => {
      throw new Error("save failed");
    });

    expect(result).toBeNull();
    expect(error.value).toBe("save failed");
  });

  it("clears previous error before executing", async () => {
    const error = ref<string | null>("previous error");

    await runMutation(error, async () => "ok");

    expect(error.value).toBeNull();
  });

  it("supports boolean return values", async () => {
    const error = ref<string | null>(null);

    const result = await runMutation(error, async () => {
      // Simulate update + reload
      return true as const;
    });

    expect(result).toBe(true);
  });

  it("returns null for non-Error throws", async () => {
    const error = ref<string | null>(null);

    const result = await runMutation(error, async () => {
      throw "string error";
    });

    expect(result).toBeNull();
    expect(error.value).toBeTruthy();
  });

  it("executes reload inside action", async () => {
    const error = ref<string | null>(null);
    const reloaded = vi.fn();

    await runMutation(error, async () => {
      reloaded();
      return true;
    });

    expect(reloaded).toHaveBeenCalledOnce();
  });

  it("calls onError callback on failure", async () => {
    const error = ref<string | null>(null);
    const onError = vi.fn();

    const result = await runMutation(
      error,
      async () => {
        throw new Error("mutation failed");
      },
      { onError },
    );

    expect(result).toBeNull();
    expect(error.value).toBe("mutation failed");
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("does not call onError on success", async () => {
    const error = ref<string | null>(null);
    const onError = vi.fn();

    const result = await runMutation(error, async () => "ok", { onError });

    expect(result).toBe("ok");
    expect(onError).not.toHaveBeenCalled();
  });

  it("swallows exceptions from onError callback", async () => {
    const error = ref<string | null>(null);

    const result = await runMutation(
      error,
      async () => {
        throw new Error("action failed");
      },
      {
        onError: () => {
          throw new Error("callback exploded");
        },
      },
    );

    // onError threw, but runMutation still returned null and set error
    expect(result).toBeNull();
    expect(error.value).toBe("action failed");
  });

  it("sets error.value before invoking onError", async () => {
    const error = ref<string | null>(null);
    let errorDuringCallback: string | null = null;

    await runMutation(
      error,
      async () => {
        throw new Error("ordering test");
      },
      {
        onError: () => {
          errorDuringCallback = error.value;
        },
      },
    );

    expect(errorDuringCallback).toBe("ordering test");
  });
});
