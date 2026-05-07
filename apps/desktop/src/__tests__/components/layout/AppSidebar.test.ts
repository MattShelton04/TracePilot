import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";

// Mock the @tracepilot/client module so the preferences store does not try
// to talk to Tauri during these UI tests.
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock();
});

// Stub heavy composables — none of them are exercised by collapse-toggle
// behaviour, but they run synchronously inside <script setup>.
vi.mock("@/composables/useAppVersion", () => ({
  useAppVersion: () => ({ appVersion: ref("0.0.0-test") }),
}));
vi.mock("@/composables/useUpdateCheck", () => ({
  useUpdateCheck: () => ({ updateResult: ref(null) }),
}));
vi.mock("@/composables/useWhatsNew", () => ({
  useWhatsNew: () => ({ openWhatsNew: vi.fn() }),
}));
vi.mock("@/composables/useSidebarNav", () => ({
  useSidebarNav: () => ({
    visiblePrimaryNav: ref([]),
    visibleAdvancedNav: ref([]),
    orchestrationNav: ref([]),
    visibleConfigNav: ref([]),
  }),
}));

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<typeof import("vue-router")>("vue-router");
  return {
    ...actual,
    useRoute: () => ({ meta: { sidebarId: "sessions" } }),
  };
});

const routerLinkStub = {
  props: ["to"],
  template: "<a :href=\"typeof to === 'string' ? to : '#'\"><slot /></a>",
};

async function mountSidebar() {
  // Lazy import so the vi.mock factories above are applied first.
  const { default: AppSidebar } = await import("@/components/layout/AppSidebar.vue");
  return mount(AppSidebar, {
    global: {
      stubs: {
        "router-link": routerLinkStub,
        LogoIcon: true,
        SdkStatusIndicator: true,
        Transition: false,
      },
    },
  });
}

describe("AppSidebar collapse toggle", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders expanded by default and exposes a collapse toggle", async () => {
    const wrapper = await mountSidebar();
    const aside = wrapper.find('[data-testid="app-sidebar"]');
    expect(aside.exists()).toBe(true);
    expect(aside.classes()).not.toContain("collapsed");

    const toggle = wrapper.find('[data-testid="sidebar-collapse-toggle"]');
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("aria-pressed")).toBe("false");
    expect(toggle.attributes("aria-label")).toBe("Collapse sidebar");
  });

  it("toggles the collapsed class and ARIA state when clicked", async () => {
    const wrapper = await mountSidebar();
    const toggle = wrapper.find('[data-testid="sidebar-collapse-toggle"]');

    await toggle.trigger("click");
    const aside = wrapper.find('[data-testid="app-sidebar"]');
    expect(aside.classes()).toContain("collapsed");
    expect(wrapper.find('[data-testid="sidebar-collapse-toggle"]').exists()).toBe(false);

    const expand = wrapper.find('[data-testid="sidebar-brand-expand"]');
    expect(expand.exists()).toBe(true);
    expect(expand.attributes("aria-label")).toBe("Expand sidebar");

    await expand.trigger("click");
    expect(aside.classes()).not.toContain("collapsed");
    expect(wrapper.find('[data-testid="sidebar-collapse-toggle"]').attributes("aria-pressed")).toBe(
      "false",
    );
  });

  it("persists the collapsed preference to localStorage", async () => {
    const wrapper = await mountSidebar();
    await wrapper.find('[data-testid="sidebar-collapse-toggle"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(localStorage.getItem(STORAGE_KEYS.sidebarCollapsed)).toBe("true");
  });

  it("hydrates the collapsed state from localStorage on mount", async () => {
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, "true");
    const wrapper = await mountSidebar();
    const aside = wrapper.find('[data-testid="app-sidebar"]');
    expect(aside.classes()).toContain("collapsed");
    expect(wrapper.find('[data-testid="sidebar-brand-expand"]').exists()).toBe(true);
  });
});
