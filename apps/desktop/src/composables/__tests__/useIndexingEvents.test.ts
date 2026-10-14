import { IPC_EVENTS } from "@tracepilot/client";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { useIndexingEvents } from "@/composables/useIndexingEvents";

const listen = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  unlisten: new Map<string, ReturnType<typeof vi.fn>>(),
  gate: null as Promise<void> | null,
}));

vi.mock("@/utils/tauriEvents", () => ({
  safeListen: async (event: string, handler: () => void) => {
    if (listen.gate) await listen.gate;
    listen.handlers.set(event, handler);
    const unlisten = vi.fn();
    listen.unlisten.set(event, unlisten);
    return unlisten;
  },
}));

function mountWith(callbacks: Parameters<typeof useIndexingEvents>[0]) {
  let setup!: () => Promise<void>;
  const wrapper = mount(
    defineComponent({
      setup() {
        ({ setup } = useIndexingEvents(callbacks));
        return () => h("div");
      },
    }),
  );
  return { wrapper, setup: () => setup() };
}

const base = () => ({ onStarted: vi.fn(), onProgress: vi.fn(), onFinished: vi.fn() });

describe("useIndexingEvents", () => {
  beforeEach(() => {
    listen.handlers.clear();
    listen.unlisten.clear();
    listen.gate = null;
  });

  it("listens for search-index passes only when asked, and stops on unmount", async () => {
    const onSearchIndexingFinished = vi.fn();
    const { wrapper, setup } = mountWith({ ...base(), onSearchIndexingFinished });
    await setup();

    listen.handlers.get(IPC_EVENTS.SEARCH_INDEXING_FINISHED)?.();
    expect(onSearchIndexingFinished).toHaveBeenCalledOnce();

    wrapper.unmount();
    expect([...listen.unlisten.values()].every((fn) => fn.mock.calls.length === 1)).toBe(true);
    expect(listen.unlisten.size).toBe(4);
  });

  it("does not listen for search-index passes without a callback", async () => {
    const { setup } = mountWith(base());
    await setup();
    expect(listen.handlers.has(IPC_EVENTS.SEARCH_INDEXING_FINISHED)).toBe(false);
  });

  it("releases listeners that finish registering after unmount", async () => {
    let open!: () => void;
    listen.gate = new Promise((resolve) => {
      open = resolve;
    });
    const { wrapper, setup } = mountWith(base());
    const pending = setup();
    wrapper.unmount();
    open();
    await pending;
    await flushPromises();

    expect(listen.unlisten.size).toBe(3);
    expect([...listen.unlisten.values()].every((fn) => fn.mock.calls.length === 1)).toBe(true);
  });
});
