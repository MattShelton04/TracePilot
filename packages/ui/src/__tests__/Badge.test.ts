import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Badge from "../components/Badge.vue";

describe("Badge", () => {
  it("renders slot content", () => {
    const wrapper = mount(Badge, {
      slots: { default: "Hello Badge" },
    });
    expect(wrapper.text()).toBe("Hello Badge");
  });

  it("applies accent variant styling", () => {
    const wrapper = mount(Badge, {
      props: { variant: "accent" },
      slots: { default: "Accent" },
    });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("bg-[var(--color-accent-muted)]");
    expect(classes).toContain("text-[var(--color-accent-fg)]");
  });

  it("applies success variant styling", () => {
    const wrapper = mount(Badge, {
      props: { variant: "success" },
      slots: { default: "Success" },
    });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("bg-[var(--color-success-muted)]");
  });

  it("applies warning variant styling", () => {
    const wrapper = mount(Badge, {
      props: { variant: "warning" },
      slots: { default: "Warning" },
    });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("bg-[var(--color-warning-muted)]");
  });

  it("applies danger variant styling", () => {
    const wrapper = mount(Badge, {
      props: { variant: "danger" },
      slots: { default: "Danger" },
    });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("bg-[var(--color-danger-muted)]");
  });

  it("applies done variant styling", () => {
    const wrapper = mount(Badge, {
      props: { variant: "done" },
      slots: { default: "Done" },
    });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("bg-[var(--color-done-muted)]");
  });

  it("applies neutral variant styling", () => {
    const wrapper = mount(Badge, {
      props: { variant: "neutral" },
      slots: { default: "Neutral" },
    });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("bg-[var(--color-neutral-muted)]");
  });

  it("uses default/neutral variant when no prop passed", () => {
    const wrapper = mount(Badge, {
      slots: { default: "Default" },
    });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("bg-[var(--color-neutral-muted)]");
    expect(classes).not.toContain("bg-[var(--color-accent-muted)]");
  });
});
