import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import UserContentEmoji from "../components/UserContentEmoji.vue";

describe("UserContentEmoji", () => {
  it("wraps emoji codepoints in .ucem", () => {
    const w = mount(UserContentEmoji, { props: { text: "Hello 🚀 world" } });
    const ucem = w.findAll(".ucem");
    expect(ucem.length).toBe(1);
    expect(ucem[0].text()).toBe("🚀");
    expect(w.text()).toContain("Hello");
    expect(w.text()).toContain("world");
  });

  it("leaves plain text untouched", () => {
    const w = mount(UserContentEmoji, { props: { text: "no emoji here" } });
    expect(w.findAll(".ucem").length).toBe(0);
    expect(w.text()).toBe("no emoji here");
  });

  it("emojiOnly filters non-emoji segments", () => {
    const w = mount(UserContentEmoji, { props: { text: "ship it 🚀 now ✅", emojiOnly: true } });
    expect(w.text().includes("ship it")).toBe(false);
    expect(w.findAll(".ucem").length).toBe(2);
  });

  it("hides emoji from a11y tree via aria-hidden", () => {
    const w = mount(UserContentEmoji, { props: { text: "🚀" } });
    expect(w.find(".ucem").attributes("aria-hidden")).toBe("true");
  });
});
