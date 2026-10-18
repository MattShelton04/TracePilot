import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import GapIndicator from "../GapIndicator.vue";

describe("GapIndicator", () => {
  it.each([
    [1, "1 turn not shown"],
    [4, "4 turns not shown"],
  ])("agrees the noun with %i hidden turn(s)", (count, text) => {
    expect(mount(GapIndicator, { props: { count } }).text()).toContain(text);
  });
});
