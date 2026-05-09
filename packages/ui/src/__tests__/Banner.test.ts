import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Banner from "../components/Banner.vue";

describe("Banner", () => {
  it("renders default info tone with role=status", () => {
    const w = mount(Banner, { slots: { default: "Hello" } });
    expect(w.classes()).toContain("banner--info");
    expect(w.attributes("role")).toBe("status");
    expect(w.text()).toContain("Hello");
  });

  it("uses role=alert for warning tone", () => {
    const w = mount(Banner, { props: { tone: "warning" }, slots: { default: "x" } });
    expect(w.attributes("role")).toBe("alert");
    expect(w.classes()).toContain("banner--warning");
  });

  it("renders title in body-strong", () => {
    const w = mount(Banner, { props: { title: "Heads up" }, slots: { default: "Body" } });
    expect(w.find(".banner__title").text()).toBe("Heads up");
  });

  it("emits dismiss when close button clicked", async () => {
    const w = mount(Banner, { props: { dismissible: true } });
    await w.find(".banner__close").trigger("click");
    expect(w.emitted("dismiss")).toHaveLength(1);
  });

  it("renders icon slot override", () => {
    const w = mount(Banner, { slots: { icon: "<i class='custom-icon' />" } });
    expect(w.find(".custom-icon").exists()).toBe(true);
  });

  it("renders actions slot", () => {
    const w = mount(Banner, { slots: { actions: "<button class='a'>Go</button>" } });
    expect(w.find(".banner__actions .a").exists()).toBe(true);
  });
});
