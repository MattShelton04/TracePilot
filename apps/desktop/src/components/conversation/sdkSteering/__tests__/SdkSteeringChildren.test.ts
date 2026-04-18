import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import SdkSteeringCommandBar from "../SdkSteeringCommandBar.vue";
import SdkSteeringDisconnectedCard from "../SdkSteeringDisconnectedCard.vue";
import SdkSteeringLinkPrompt from "../SdkSteeringLinkPrompt.vue";
import SdkSteeringSentLog from "../SdkSteeringSentLog.vue";
import SdkSteeringSessionLabel from "../SdkSteeringSessionLabel.vue";
import {
  SdkSteeringKey,
  type SdkSteeringContext,
} from "@/composables/useSdkSteering";

function makeCtx(overrides: Partial<SdkSteeringContext> = {}): SdkSteeringContext {
  const base = {
    sdk: {
      isConnected: true,
      isConnecting: false,
      connectionMode: "stdio" as const,
      connectionState: "connected" as const,
      sendingMessage: false,
      lastError: null as string | null,
      sessions: [] as unknown[],
      models: [] as Array<{ id: string; name?: string }>,
      isTcpMode: false,
      resumeSession: vi.fn(),
      sendMessage: vi.fn(),
      setSessionMode: vi.fn(),
      abortSession: vi.fn(),
      destroySession: vi.fn(),
      connect: vi.fn(),
    },
    prompt: "",
    inputEl: null,
    userLinked: false,
    pendingModel: null,
    showModelPicker: false,
    sentMessages: [] as Array<{
      id: number;
      text: string;
      timestamp: number;
      status: "sending" | "sent" | "error";
      turnId?: string;
      error?: string;
    }>,
    sessionError: null,
    resuming: false,
    resolvedSessionId: null,
    isEnabled: true,
    isVisible: true,
    isLinked: false,
    linkedSession: null,
    effectiveSessionId: "sess-1",
    modelPickerStyle: {},
    currentMode: "interactive" as const,
    currentModel: "gpt-4",
    inferredModel: null,
    hasText: false,
    shortSessionId: "sess-1",
    inlineError: null,
    modes: [
      { value: "interactive" as const, label: "Ask", icon: "💬" },
      { value: "plan" as const, label: "Plan", icon: "📋" },
      { value: "autopilot" as const, label: "Auto", icon: "🚀" },
    ],
    linkSession: vi.fn(),
    handleSend: vi.fn(),
    handleModeChange: vi.fn(),
    handleAbort: vi.fn(),
    handleUnlinkSession: vi.fn(),
    handleShutdownSession: vi.fn(),
    handleKeydown: vi.fn(),
    handleConnect: vi.fn(),
    clearError: vi.fn(),
    autoResize: vi.fn(),
    setInputEl: vi.fn(),
    selectPendingModel: vi.fn(),
    toggleModelPicker: vi.fn(),
  };
  return reactive({ ...base, ...overrides }) as unknown as SdkSteeringContext;
}

function mountWithCtx<T>(component: T, ctx: SdkSteeringContext) {
  const Harness = defineComponent({
    setup() {
      provide(SdkSteeringKey, ctx);
      return () => h("div", [h(component as never)]);
    },
  });
  return mount(Harness, {
    global: { stubs: { Teleport: true, TransitionGroup: false } },
  });
}

describe("SdkSteeringSentLog", () => {
  it("renders nothing when empty", () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SdkSteeringSentLog, ctx);
    expect(wrapper.find(".cb-sent-log").exists()).toBe(false);
  });

  it("renders a sending row with the prompt text", () => {
    const ctx = makeCtx({
      sentMessages: [
        { id: 1, text: "hello world", timestamp: Date.now(), status: "sending" },
      ],
    } as never);
    const wrapper = mountWithCtx(SdkSteeringSentLog, ctx);
    expect(wrapper.find(".cb-sent-item").exists()).toBe(true);
    expect(wrapper.text()).toContain("hello world");
    expect(wrapper.text()).toContain("sending");
  });
});

describe("SdkSteeringSessionLabel", () => {
  it("shows Not linked + short id without action buttons", () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SdkSteeringSessionLabel, ctx);
    expect(wrapper.text()).toContain("Not linked");
    expect(wrapper.text()).toContain("sess-1");
    expect(wrapper.find(".cb-btn-unlink").exists()).toBe(false);
    expect(wrapper.find(".cb-btn-destroy").exists()).toBe(false);
  });

  it("invokes unlink and shutdown handlers when linked", async () => {
    const ctx = makeCtx({ isLinked: true } as never);
    const wrapper = mountWithCtx(SdkSteeringSessionLabel, ctx);
    await wrapper.find(".cb-btn-unlink").trigger("click");
    expect(ctx.handleUnlinkSession).toHaveBeenCalled();
    await wrapper.find(".cb-btn-destroy").trigger("click");
    expect(ctx.handleShutdownSession).toHaveBeenCalled();
  });
});

describe("SdkSteeringLinkPrompt", () => {
  it("clicks link button and toggles model picker", async () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SdkSteeringLinkPrompt, ctx);
    await wrapper.find(".cb-btn-link").trigger("click");
    expect(ctx.linkSession).toHaveBeenCalled();
    await wrapper.find(".cb-model-pick-btn").trigger("click");
    expect(ctx.toggleModelPicker).toHaveBeenCalled();
  });

  it("shows 'Linking session…' when resuming", () => {
    const ctx = makeCtx({ resuming: true } as never);
    const wrapper = mountWithCtx(SdkSteeringLinkPrompt, ctx);
    expect(wrapper.text()).toContain("Linking session");
    expect(wrapper.find(".cb-btn-link").exists()).toBe(false);
  });
});

describe("SdkSteeringCommandBar", () => {
  it("send click invokes handleSend, mode-pill click invokes handleModeChange", async () => {
    const ctx = makeCtx({ hasText: true, prompt: "hi" } as never);
    const wrapper = mountWithCtx(SdkSteeringCommandBar, ctx);
    await wrapper.find(".cb-btn-send").trigger("click");
    expect(ctx.handleSend).toHaveBeenCalled();

    const pills = wrapper.findAll(".cb-mode-pill");
    await pills[1].trigger("click");
    expect(ctx.handleModeChange).toHaveBeenCalledWith("plan");
  });

  it("abort button invokes handleAbort when visible", async () => {
    const ctx = makeCtx();
    ctx.sdk.sendingMessage = true;
    const wrapper = mountWithCtx(SdkSteeringCommandBar, ctx);
    await wrapper.find(".cb-btn-abort").trigger("click");
    expect(ctx.handleAbort).toHaveBeenCalled();
  });
});

describe("SdkSteeringDisconnectedCard", () => {
  it("connect button calls handleConnect", async () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SdkSteeringDisconnectedCard, ctx);
    await wrapper.find(".cb-btn-connect").trigger("click");
    expect(ctx.handleConnect).toHaveBeenCalled();
  });
});
