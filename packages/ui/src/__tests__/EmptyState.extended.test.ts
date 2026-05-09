import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import EmptyState from "../components/EmptyState.vue";

describe("EmptyState (B-Layout-Status extensions)", () => {
  it("renders description prop in the desc paragraph", () => {
    const wrapper = mount(EmptyState, { props: { description: "Nothing to show yet." } });
    expect(wrapper.find(".empty-state-desc").text()).toBe("Nothing to show yet.");
  });

  it("description prop takes precedence over legacy message prop", () => {
    const wrapper = mount(EmptyState, {
      props: { description: "New", message: "Old" },
    });
    expect(wrapper.find(".empty-state-desc").text()).toBe("New");
  });

  it("applies size modifier classes", () => {
    const wrapper = mount(EmptyState, { props: { size: "lg" } });
    expect(wrapper.find(".empty-state").classes()).toContain("empty-state--lg");
  });

  it("renders primaryAction and invokes onClick", async () => {
    const onClick = vi.fn();
    const wrapper = mount(EmptyState, {
      props: { primaryAction: { label: "Create one", onClick } },
    });
    const btn = wrapper.find(".empty-state-btn--primary");
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toBe("Create one");
    await btn.trigger("click");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders secondaryAction independently of primaryAction", async () => {
    const onClick = vi.fn();
    const wrapper = mount(EmptyState, {
      props: { secondaryAction: { label: "Learn more", onClick } },
    });
    const btn = wrapper.find(".empty-state-btn--secondary");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("custom actions slot overrides config-prop buttons", () => {
    const wrapper = mount(EmptyState, {
      props: { primaryAction: { label: "P", onClick: () => {} } },
      slots: { actions: '<button class="custom">X</button>' },
    });
    expect(wrapper.find(".custom").exists()).toBe(true);
    expect(wrapper.find(".empty-state-btn--primary").exists()).toBe(false);
  });

  it("exposes data-tp-component selector", () => {
    const wrapper = mount(EmptyState);
    expect(wrapper.find('[data-tp-component="EmptyState"]').exists()).toBe(true);
  });
});
