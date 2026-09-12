// biome-ignore-all assist/source/organizeImports: setup must register mocks before the composable imports.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineAsyncComponent, defineComponent, h, nextTick, provide } from "vue";
import { FIXTURE_DETAIL, mocks, setupSessionDetailStoreTest } from "./setup";

setupSessionDetailStoreTest();

const wrappers: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

describe("session detail context across module reloads", () => {
  it("preserves the public injection key when its defining modules are evaluated again", async () => {
    const beforeReload = await import("@/composables/useSessionDetail");
    vi.resetModules();
    const afterReload = await import("@/composables/useSessionDetail");

    expect(afterReload).not.toBe(beforeReload);
    expect(afterReload.SESSION_DETAIL_KEY).toBe(beforeReload.SESSION_DETAIL_KEY);
  });

  it("resolves each retained provider from a reloaded async consumer without sharing tab state", async () => {
    const providerModule = await import("@/composables/useSessionDetail");
    mocks.getSessionDetail.mockImplementation(async (id: string) => ({
      ...FIXTURE_DETAIL,
      id,
      eventCount: id === "audit-first" ? 842 : 30,
    }));
    const first = providerModule.toSessionDetailContext(
      providerModule.createSessionDetailInstance(),
    );
    const second = providerModule.toSessionDetailContext(
      providerModule.createSessionDetailInstance(),
    );
    await Promise.all([first.loadDetail("audit-first"), second.loadDetail("audit-second")]);

    vi.resetModules();
    const { useSessionDetailContext } = await import("@/composables/useSessionDetailContext");
    const { useSessionDetailStore } = await import("@/stores/sessionDetail");
    const Consumer = defineComponent({
      setup() {
        const context = useSessionDetailContext();
        return () => h("output", `${context.sessionId}:${context.detail?.eventCount ?? 0}`);
      },
    });
    const AsyncConsumer = defineAsyncComponent(async () => Consumer);
    const retainedProvider = (context: typeof first) =>
      defineComponent({
        setup() {
          provide(providerModule.SESSION_DETAIL_KEY, context);
          return () => h(AsyncConsumer);
        },
      });
    const firstProvider = retainedProvider(first);
    const secondProvider = retainedProvider(second);
    const wrapper = mount(
      defineComponent({
        setup: () => () => h("div", [h(firstProvider), h(secondProvider), h(Consumer)]),
      }),
    );
    wrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.findAll("output").map((output) => output.text())).toEqual([
      "audit-first:842",
      "audit-second:30",
      "null:0",
    ]);
    expect(useSessionDetailStore().sessionId).toBeNull();

    first.reset();
    await nextTick();
    expect(wrapper.findAll("output").map((output) => output.text())).toEqual([
      "null:0",
      "audit-second:30",
      "null:0",
    ]);
  });
});
