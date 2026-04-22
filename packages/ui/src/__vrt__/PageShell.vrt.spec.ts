import { expect, test } from "@playwright/experimental-ct-vue";
import PageShell from "../components/PageShell.vue";
import { SNAPSHOT_OPTS } from "./index";

test.describe("PageShell", () => {
  test("default slot content", async ({ mount }) => {
    const component = await mount(PageShell, {
      slots: {
        default:
          '<div style="padding:16px;border:1px solid var(--border-default,#3f3f46);border-radius:8px;">Default slot content for PageShell</div>',
      },
    });
    await expect(component).toHaveScreenshot("default.png", SNAPSHOT_OPTS);
  });
});
