import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import ErrorBoundary from "../../components/ErrorBoundary.vue";

vi.mock("@/utils/logger", () => ({
  logError: vi.fn(),
}));

describe("ErrorBoundary", () => {
  it("renders default slot content when no error", () => {
    const wrapper = mount(ErrorBoundary, {
      slots: { default: '<div class="child">Hello</div>' },
    });
    expect(wrapper.find(".child").exists()).toBe(true);
    expect(wrapper.find(".error-boundary").exists()).toBe(false);
  });

  it("renders default fallback when child throws during render", async () => {
    const shouldThrow = ref(true);
    const ThrowingChild = defineComponent({
      setup() {
        return () => {
          if (shouldThrow.value) throw new Error("Render boom");
          return h("div", { class: "ok" }, "ok");
        };
      },
    });

    const wrapper = mount(ErrorBoundary, {
      slots: { default: () => h(ThrowingChild) },
    });
    await flushPromises();

    expect(wrapper.find(".error-boundary").exists()).toBe(true);
    expect(wrapper.text()).toContain("Render boom");
    expect(wrapper.find("button").text()).toContain("Try Again");
  });

  it("retry() clears the error and re-renders the slot", async () => {
    const shouldThrow = ref(true);
    const ThrowingChild = defineComponent({
      setup() {
        return () => {
          if (shouldThrow.value) throw new Error("Transient");
          return h("div", { class: "recovered" }, "recovered");
        };
      },
    });

    const wrapper = mount(ErrorBoundary, {
      slots: { default: () => h(ThrowingChild) },
    });
    await flushPromises();
    expect(wrapper.find(".error-boundary").exists()).toBe(true);

    shouldThrow.value = false;
    await wrapper.find("button").trigger("click");
    await nextTick();

    expect(wrapper.find(".error-boundary").exists()).toBe(false);
    expect(wrapper.find(".recovered").exists()).toBe(true);
  });

  it("renders the named fallback slot with error and retry props when provided", async () => {
    const ThrowingChild = defineComponent({
      setup() {
        return () => {
          throw new Error("Custom fallback");
        };
      },
    });

    const wrapper = mount(ErrorBoundary, {
      slots: {
        default: () => h(ThrowingChild),
        fallback: (props: { error: Error; retry: () => void }) =>
          h("div", { class: "custom-fallback" }, [
            h("span", { class: "msg" }, props.error.message),
            h("button", { class: "custom-retry", onClick: props.retry }, "reset"),
          ]),
      },
    });
    await flushPromises();

    expect(wrapper.find(".error-boundary").exists()).toBe(false);
    expect(wrapper.find(".custom-fallback").exists()).toBe(true);
    expect(wrapper.find(".msg").text()).toBe("Custom fallback");
  });

  it("calls logError when an error is captured", async () => {
    const { logError } = await import("@/utils/logger");
    (logError as ReturnType<typeof vi.fn>).mockClear();

    const ThrowingChild = defineComponent({
      setup() {
        return () => {
          throw new Error("Logged error");
        };
      },
    });

    mount(ErrorBoundary, {
      slots: { default: () => h(ThrowingChild) },
    });
    await flushPromises();

    expect(logError).toHaveBeenCalled();
    const call = (logError as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain("ErrorBoundary");
  });
});
