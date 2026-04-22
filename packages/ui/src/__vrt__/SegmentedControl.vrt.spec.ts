import { expect, test } from "@playwright/experimental-ct-vue";
import SegmentedControl from "../components/SegmentedControl.vue";
import { SNAPSHOT_OPTS } from "./index";

const options = [
  { value: "all", label: "All", count: 12 },
  { value: "open", label: "Open", count: 5 },
  { value: "closed", label: "Closed", count: 7 },
];

test.describe("SegmentedControl", () => {
  test("rounded=square (default)", async ({ mount }) => {
    const component = await mount(SegmentedControl, {
      props: { modelValue: "all", options },
    });
    await expect(component).toHaveScreenshot("rounded-square.png", SNAPSHOT_OPTS);
  });

  test("rounded=pill", async ({ mount }) => {
    const component = await mount(SegmentedControl, {
      props: { modelValue: "open", options, rounded: "pill" },
    });
    await expect(component).toHaveScreenshot("rounded-pill.png", SNAPSHOT_OPTS);
  });
});
