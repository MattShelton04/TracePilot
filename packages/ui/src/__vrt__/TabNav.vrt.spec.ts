import { test, expect } from "@playwright/experimental-ct-vue";
import TabNav from "../components/TabNav.vue";
import { SNAPSHOT_OPTS } from "./index";

// Pass `modelValue` to force TabNav into local mode so it does not call
// useRoute/useRouter (vue-router is not installed in the CT harness).

const tabs = [
  { name: "overview", routeName: "overview", label: "Overview", count: 3 },
  { name: "agents", routeName: "agents", label: "Agents", count: 7 },
  { name: "tools", routeName: "tools", label: "Tools" },
];

const iconTabs = [
  { name: "overview", routeName: "overview", label: "Overview", icon: "📊" },
  { name: "agents", routeName: "agents", label: "Agents", icon: "🤖" },
  { name: "tools", routeName: "tools", label: "Tools", icon: "🛠" },
];

test.describe("TabNav", () => {
  test("default", async ({ mount }) => {
    const component = await mount(TabNav, {
      props: { tabs, modelValue: "overview" },
    });
    await expect(component).toHaveScreenshot("default.png", SNAPSHOT_OPTS);
  });

  test("with icons", async ({ mount }) => {
    const component = await mount(TabNav, {
      props: { tabs: iconTabs, modelValue: "overview" },
    });
    await expect(component).toHaveScreenshot("with-icons.png", SNAPSHOT_OPTS);
  });

  test("variant=pill", async ({ mount }) => {
    const component = await mount(TabNav, {
      props: { tabs, modelValue: "agents", variant: "pill" },
    });
    await expect(component).toHaveScreenshot("variant-pill.png", SNAPSHOT_OPTS);
  });

  test("staggered", async ({ mount }) => {
    // `reducedMotion: reduce` + the `*` animation reset in playwright/index.ts
    // ensure the --stagger delay never produces mid-animation frames.
    const component = await mount(TabNav, {
      props: { tabs: iconTabs, modelValue: "overview", staggered: true },
    });
    await expect(component).toHaveScreenshot("staggered.png", SNAPSHOT_OPTS);
  });
});
