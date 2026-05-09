import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { h } from "vue";
import Field from "../components/Field.vue";

describe("Field", () => {
  it("auto-generates label-for association", () => {
    const w = mount(Field, {
      props: { label: "Name" },
      slots: {
        default: ({ id }: { id: string }) => h("input", { id, "data-test": "ipt" }),
      },
    });
    const labelFor = w.find("label").attributes("for");
    expect(labelFor).toBeTruthy();
    expect(w.find('[data-test="ipt"]').attributes("id")).toBe(labelFor);
  });

  it("uses explicit `for` prop when provided", () => {
    const w = mount(Field, { props: { label: "x", for: "my-id" } });
    expect(w.find("label").attributes("for")).toBe("my-id");
  });

  it("renders required indicator", () => {
    const w = mount(Field, { props: { label: "x", required: true } });
    expect(w.find(".field__required").exists()).toBe(true);
    expect(w.classes()).toContain("field--required");
  });

  it("renders error message with role=alert", () => {
    const w = mount(Field, {
      props: { label: "x", status: "error", errorMessage: "Bad" },
    });
    const err = w.find(".field__error");
    expect(err.exists()).toBe(true);
    expect(err.attributes("role")).toBe("alert");
    expect(err.text()).toBe("Bad");
  });

  it("applies layout class", () => {
    const w = mount(Field, { props: { label: "x", layout: "stacked" } });
    expect(w.classes()).toContain("field--stacked");
  });

  it("renders description with id matching aria-describedby", () => {
    const captured: Record<string, string | undefined> = {};
    mount(Field, {
      props: { label: "x", description: "help" },
      slots: {
        default: (binds: { ariaDescribedby?: string }) => {
          captured.describedBy = binds.ariaDescribedby;
          return h("input");
        },
      },
    });
    expect(captured.describedBy).toBeTruthy();
  });
});
