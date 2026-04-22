import { expect, test } from "@playwright/experimental-ct-vue";
import PageHeader from "../components/PageHeader.vue";
import { SNAPSHOT_OPTS } from "./index";

test.describe("PageHeader", () => {
  test("default", async ({ mount }) => {
    const component = await mount(PageHeader, {
      props: { title: "Session overview", subtitle: "3 active agents" },
    });
    await expect(component).toHaveScreenshot("default.png", SNAPSHOT_OPTS);
  });

  test("size=sm", async ({ mount }) => {
    const component = await mount(PageHeader, {
      props: { title: "Session overview", subtitle: "3 active agents", size: "sm" },
    });
    await expect(component).toHaveScreenshot("size-sm.png", SNAPSHOT_OPTS);
  });

  test("size=lg", async ({ mount }) => {
    const component = await mount(PageHeader, {
      props: { title: "Session overview", subtitle: "3 active agents", size: "lg" },
    });
    await expect(component).toHaveScreenshot("size-lg.png", SNAPSHOT_OPTS);
  });

  test("inlineSubtitle", async ({ mount }) => {
    const component = await mount(PageHeader, {
      props: {
        title: "Session overview",
        subtitle: "3 active agents",
        inlineSubtitle: true,
      },
    });
    await expect(component).toHaveScreenshot("inline-subtitle.png", SNAPSHOT_OPTS);
  });
});
