import { expect, test } from "@playwright/experimental-ct-vue";
import StatCard from "../components/StatCard.vue";
import { SNAPSHOT_OPTS } from "./index";

test.describe("StatCard", () => {
  test("default", async ({ mount }) => {
    const component = await mount(StatCard, {
      props: { value: "42", label: "Active sessions" },
    });
    await expect(component).toHaveScreenshot("default.png", SNAPSHOT_OPTS);
  });

  test("variant=plain", async ({ mount }) => {
    const component = await mount(StatCard, {
      props: { value: "3", label: "Incidents", variant: "plain" },
    });
    await expect(component).toHaveScreenshot("variant-plain.png", SNAPSHOT_OPTS);
  });

  test("accentColor", async ({ mount }) => {
    const component = await mount(StatCard, {
      props: {
        value: "7",
        label: "Open alerts",
        variant: "plain",
        accentColor: "#f43f5e",
      },
    });
    await expect(component).toHaveScreenshot("accent-color.png", SNAPSHOT_OPTS);
  });

  test("customValueClass gradient", async ({ mount }) => {
    const component = await mount(StatCard, {
      props: {
        value: "128k",
        label: "Tokens used",
        gradient: true,
        customValueClass: "gradient-value",
      },
    });
    await expect(component).toHaveScreenshot("custom-gradient.png", SNAPSHOT_OPTS);
  });

  test("labelStyle=uppercase", async ({ mount }) => {
    const component = await mount(StatCard, {
      props: {
        value: "12",
        label: "agents online",
        labelStyle: "uppercase",
      },
    });
    await expect(component).toHaveScreenshot("label-uppercase.png", SNAPSHOT_OPTS);
  });
});
