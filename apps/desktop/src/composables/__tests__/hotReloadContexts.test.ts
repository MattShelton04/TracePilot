import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineAsyncComponent, defineComponent, h, nextTick, provide, reactive, ref } from "vue";
import type { UseMcpServerDetailReturn } from "../useMcpServerDetail";
import type { SdkSteeringContext } from "../useSdkSteering";

// This exercises actual context resolution, not state creation or IPC. Keep the
// reload test independent of the unrelated store graph and its startup cost.
vi.mock("@/composables/sdkSteering/state", () => ({ useSdkSteeringState: vi.fn() }));
vi.mock("@/composables/sdkSteering/actions", () => ({ useSdkSteeringActions: vi.fn() }));
vi.mock("@/composables/sdkSteering/modelPicker", () => ({ useModelPicker: vi.fn() }));
vi.mock("@/stores/mcp", () => ({ useMcpStore: vi.fn() }));
vi.mock("@tracepilot/ui", () => ({ useToast: vi.fn() }));

const wrappers: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

describe("retained providers with re-evaluated development modules", () => {
  it("keeps SDK steering consumers attached to their own provider after module reload", async () => {
    const providerModule = await import("../useSdkSteering");
    const first = reactive({ prompt: "first draft" }) as SdkSteeringContext;
    const second = reactive({ prompt: "second draft" }) as SdkSteeringContext;
    vi.resetModules();
    const consumerModule = await import("../useSdkSteering");
    expect(consumerModule).not.toBe(providerModule);
    expect(consumerModule.SdkSteeringKey).toBe(providerModule.SdkSteeringKey);

    const Consumer = defineAsyncComponent(async () =>
      defineComponent({
        setup() {
          const context = consumerModule.useSdkSteeringContext();
          return () => h("output", context.prompt);
        },
      }),
    );
    const retainedProvider = (context: SdkSteeringContext) =>
      defineComponent({
        setup() {
          provide(providerModule.SdkSteeringKey, context);
          return () => h(Consumer);
        },
      });
    const wrapper = mount(
      defineComponent({
        setup: () => () => h("div", [h(retainedProvider(first)), h(retainedProvider(second))]),
      }),
    );
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.findAll("output").map((output) => output.text())).toEqual([
      "first draft",
      "second draft",
    ]);
    first.prompt = "edited first draft";
    await nextTick();
    expect(wrapper.findAll("output").map((output) => output.text())).toEqual([
      "edited first draft",
      "second draft",
    ]);
  });

  it("keeps MCP detail consumers attached to their own provider after module reload", async () => {
    const providerModule = await import("../useMcpServerDetail");
    const first = { toolSearch: ref("first filter") } as UseMcpServerDetailReturn;
    const second = { toolSearch: ref("second filter") } as UseMcpServerDetailReturn;
    vi.resetModules();
    const consumerModule = await import("../useMcpServerDetail");
    expect(consumerModule).not.toBe(providerModule);
    expect(consumerModule.McpServerDetailKey).toBe(providerModule.McpServerDetailKey);

    const Consumer = defineAsyncComponent(async () =>
      defineComponent({
        setup() {
          const context = consumerModule.useMcpServerDetailContext();
          return () => h("output", context.toolSearch.value);
        },
      }),
    );
    const retainedProvider = (context: UseMcpServerDetailReturn) =>
      defineComponent({
        setup() {
          provide(providerModule.McpServerDetailKey, context);
          return () => h(Consumer);
        },
      });
    const wrapper = mount(
      defineComponent({
        setup: () => () => h("div", [h(retainedProvider(first)), h(retainedProvider(second))]),
      }),
    );
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.findAll("output").map((output) => output.text())).toEqual([
      "first filter",
      "second filter",
    ]);
    first.toolSearch.value = "edited first filter";
    await nextTick();
    expect(wrapper.findAll("output").map((output) => output.text())).toEqual([
      "edited first filter",
      "second filter",
    ]);
    expect(providerModule.McpServerDetailKey).not.toBe(
      (await import("../useSdkSteering")).SdkSteeringKey,
    );
  });
});
