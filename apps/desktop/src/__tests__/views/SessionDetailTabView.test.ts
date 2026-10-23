import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import SessionDetailTabView from "@/views/SessionDetailTabView.vue";

const mocks = vi.hoisted(() => ({ viewer: false }));

vi.mock("@/composables/useWindowRole", () => ({
  useWindowRole: () => ({ isViewer: () => mocks.viewer }),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock();
});

// The panel's header actions read the router it is given (Export, Replay).
const PanelStub = defineComponent({
  name: "SessionDetailPanel",
  props: { router: { type: Object, default: undefined } },
  template: "<div />",
});

function mountTab(plugins: unknown[] = []) {
  return mount(SessionDetailTabView, {
    props: { sessionId: "session-1", activeSubTab: "overview" },
    global: {
      plugins: plugins as never[],
      stubs: { SessionDetailPanel: PanelStub },
    },
  });
}

describe("SessionDetailTabView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.viewer = false;
  });

  it("gives a main-window tab the app's router, so its header can export", () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    const wrapper = mountTab([router]);
    expect(wrapper.getComponent(PanelStub).props("router")).toBe(router);
  });

  it("gives a viewer window, which has no router, none", () => {
    mocks.viewer = true;
    const wrapper = mountTab();
    expect(wrapper.getComponent(PanelStub).props("router")).toBeNull();
  });
});
