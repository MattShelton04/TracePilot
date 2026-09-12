import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, ref } from "vue";
import { SdkSteeringKey, useSdkSteering } from "@/composables/useSdkSteering";
import SdkSteeringLinkPrompt from "../SdkSteeringLinkPrompt.vue";

const sdk = vi.hoisted(() => ({
  isConnected: true,
  isConnecting: false,
  connectionMode: "stdio",
  connectionState: "connected",
  sessions: [],
  sessionStatesById: {},
  models: Array.from({ length: 14 }, (_, i) => ({
    id: `audit-model-${i + 1}`,
    name: `Audit model ${i + 1}`,
  })),
  lastError: null,
  isSending: vi.fn(() => false),
  resumeSession: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock("@/stores/sdk", () => ({ useSdkStore: () => sdk }));
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ isFeatureEnabled: () => true }),
}));
vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => ({ turns: [] }),
}));

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  expect(sdk.resumeSession).not.toHaveBeenCalled();
  expect(sdk.sendMessage).not.toHaveBeenCalled();
});

async function setup(pending: string | null = null) {
  let ctx!: ReturnType<typeof useSdkSteering>;
  const host = mount(
    defineComponent({
      setup() {
        ctx = useSdkSteering({ sessionIdRef: ref("audit-session"), sessionCwdRef: ref(undefined) });
        ctx.pendingModel = pending;
        provide(SdkSteeringKey, ctx);
        return () => h(SdkSteeringLinkPrompt);
      },
    }),
    { attachTo: document.body },
  );
  const trigger = host.get<HTMLButtonElement>(".cb-model-pick-btn");
  trigger.element.focus();
  await trigger.trigger("click");
  await flushPromises();
  const menu = () => document.body.querySelector<HTMLElement>(".cb-model-dropdown-portal");
  const key = async (value: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    document.activeElement?.dispatchEvent(event);
    await flushPromises();
    return event;
  };
  return { ctx, trigger, menu, key };
}

describe("pre-link steering model picker", () => {
  it("exposes the checked model and initially focuses that choice", async () => {
    const { trigger, menu } = await setup("audit-model-12");
    expect(trigger.attributes("aria-haspopup")).toBe("menu");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(trigger.attributes("aria-controls")).toBe(menu()?.id);
    expect(menu()?.getAttribute("role")).toBe("menu");
    expect(menu()?.getAttribute("aria-label")).toBe("Session model");
    expect(menu()?.querySelectorAll('[role="menuitemradio"]')).toHaveLength(15);
    const checked = menu()?.querySelectorAll('[aria-checked="true"]');
    expect(checked).toHaveLength(1);
    expect(document.activeElement).toBe(checked?.[0]);
    expect(document.activeElement?.textContent).toContain("Audit model 12");
    expect(
      [...menu()!.querySelectorAll(".cb-check")].every(
        (mark) => mark.getAttribute("aria-hidden") === "true",
      ),
    ).toBe(true);
  });

  it("moves focus without selecting until a model is activated, then restores the trigger", async () => {
    const { ctx, trigger, menu, key } = await setup();
    expect(document.activeElement?.textContent).toContain("Default");
    for (const [value, text] of [
      ["ArrowDown", "Audit model 1"],
      ["End", "Audit model 14"],
      ["ArrowDown", "Default"],
      ["ArrowUp", "Audit model 14"],
      ["Home", "Default"],
    ]) {
      expect((await key(value)).defaultPrevented).toBe(true);
      expect(document.activeElement?.textContent).toContain(text);
      expect(ctx.pendingModel).toBeNull();
    }
    await key("ArrowDown");
    expect((await key("Enter")).defaultPrevented).toBe(false);
    (document.activeElement as HTMLButtonElement).click();
    await flushPromises();
    expect(ctx.pendingModel).toBe("audit-model-1");
    expect(ctx.userLinked).toBe(false);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger.element);
    expect(trigger.attributes("aria-expanded")).toBe("false");
    await trigger.trigger("click");
    await flushPromises();
    expect(document.activeElement?.textContent).toContain("Audit model 1");
    await key("Home");
    (document.activeElement as HTMLButtonElement).click();
    await flushPromises();
    expect(ctx.pendingModel).toBeNull();
  });

  it.each([
    "Escape",
    "Tab",
    "Shift+Tab",
  ])("dismisses with %s without changing the pending choice", async (value) => {
    const { ctx, trigger, menu, key } = await setup("audit-model-3");
    await key(value === "Shift+Tab" ? "Tab" : value, { shiftKey: value === "Shift+Tab" });
    expect(menu()).toBeNull();
    expect(ctx.pendingModel).toBe("audit-model-3");
    expect(document.activeElement).toBe(trigger.element);
  });
});
