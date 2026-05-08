import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AsyncPageState from "../AsyncPageState.vue";

describe("AsyncPageState", () => {
  it("renders the default loading slot when loading=true", () => {
    const wrapper = mount(AsyncPageState, {
      props: { loading: true, error: null, empty: false },
      slots: { default: '<div class="content">data</div>' },
    });
    expect(wrapper.attributes("data-phase")).toBe("loading");
    expect(wrapper.find(".loading-spinner").exists()).toBe(true);
    expect(wrapper.find(".content").exists()).toBe(false);
  });

  it("loading takes precedence over error and empty", () => {
    const wrapper = mount(AsyncPageState, {
      props: { loading: true, error: "oops", empty: true },
    });
    expect(wrapper.attributes("data-phase")).toBe("loading");
  });

  it("renders the error slot when error is truthy and not loading", () => {
    const wrapper = mount(AsyncPageState, {
      props: { loading: false, error: "boom", empty: false },
      slots: {
        error: '<div class="custom-error">{{ params }}</div>',
        default: '<div class="content">data</div>',
      },
    });
    expect(wrapper.attributes("data-phase")).toBe("error");
    expect(wrapper.find(".custom-error").exists()).toBe(true);
    expect(wrapper.find(".content").exists()).toBe(false);
  });

  it("error takes precedence over empty", () => {
    const wrapper = mount(AsyncPageState, {
      props: { loading: false, error: "x", empty: true },
    });
    expect(wrapper.attributes("data-phase")).toBe("error");
  });

  it("renders the empty slot when empty=true and no error/loading", () => {
    const wrapper = mount(AsyncPageState, {
      props: { loading: false, error: null, empty: true },
      slots: {
        empty: '<div class="custom-empty">nothing</div>',
        default: '<div class="content">data</div>',
      },
    });
    expect(wrapper.attributes("data-phase")).toBe("empty");
    expect(wrapper.find(".custom-empty").exists()).toBe(true);
    expect(wrapper.find(".content").exists()).toBe(false);
  });

  it("renders the default slot when ready", () => {
    const wrapper = mount(AsyncPageState, {
      props: { loading: false, error: null, empty: false },
      slots: { default: '<div class="content">data</div>' },
    });
    expect(wrapper.attributes("data-phase")).toBe("ready");
    expect(wrapper.find(".content").exists()).toBe(true);
  });

  it("treats undefined error as falsy", () => {
    const wrapper = mount(AsyncPageState, {
      props: { loading: false, error: undefined, empty: false },
      slots: { default: '<div class="content">data</div>' },
    });
    expect(wrapper.attributes("data-phase")).toBe("ready");
    expect(wrapper.find(".content").exists()).toBe(true);
  });

  it("uses default loading/error/empty primitives when slots are not provided", () => {
    const loadingWrapper = mount(AsyncPageState, {
      props: { loading: true, error: null, empty: false },
    });
    expect(loadingWrapper.find(".loading-spinner").exists()).toBe(true);

    const errorWrapper = mount(AsyncPageState, {
      props: { loading: false, error: "broken", empty: false },
    });
    expect(errorWrapper.find(".error-state").exists()).toBe(true);

    const emptyWrapper = mount(AsyncPageState, {
      props: { loading: false, error: null, empty: true },
    });
    expect(emptyWrapper.find(".empty-state").exists()).toBe(true);
  });
});
