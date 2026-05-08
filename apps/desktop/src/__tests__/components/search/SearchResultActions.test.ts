import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SearchResultActions from "../../../components/search/SearchResultActions.vue";

const stubs = { "router-link": { template: "<a :href='to'><slot /></a>", props: ["to"] } };

describe("SearchResultActions", () => {
  it("renders a view-in-session router-link to sessionLink", () => {
    const wrapper = mount(SearchResultActions, {
      props: { sessionLink: "/session/abc" },
      global: { stubs },
    });
    expect(wrapper.find(".result-view-btn").exists()).toBe(true);
    expect(wrapper.find(".result-view-btn").text()).toContain("View in session");
  });

  it("emits copy and toggles copied affordance on copy click", async () => {
    vi.useFakeTimers();
    const wrapper = mount(SearchResultActions, {
      props: { sessionLink: "/session/abc" },
      global: { stubs },
    });

    await wrapper.find(".result-copy-btn").trigger("click");
    expect(wrapper.emitted("copy")).toEqual([[]]);
    expect(wrapper.find(".result-copy-btn--copied").exists()).toBe(true);
    expect(wrapper.find(".result-copy-btn").attributes("title")).toBe("Copied!");

    vi.advanceTimersByTime(1500);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".result-copy-btn--copied").exists()).toBe(false);
    vi.useRealTimers();
  });

  it("stops propagation on copy click (does not bubble outer click)", async () => {
    const outer = vi.fn();
    const wrapper = mount(
      {
        components: { SearchResultActions },
        props: ["sessionLink"],
        template: `<div @click="$emit('outer')"><SearchResultActions :sessionLink="sessionLink" /></div>`,
        emits: ["outer"],
      },
      {
        props: { sessionLink: "/x" },
        global: { stubs },
        attrs: { onOuter: outer },
      },
    );
    await wrapper.find(".result-copy-btn").trigger("click");
    expect(outer).not.toHaveBeenCalled();
  });
});
