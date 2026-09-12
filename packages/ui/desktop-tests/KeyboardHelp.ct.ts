import { expect, test } from "@playwright/experimental-ct-vue";
import KeyboardHelpHarness from "./KeyboardHelpHarness.vue";

for (const width of [960, 1440, 2560]) {
  test(`keyboard help keeps every shortcut inside its padded dialog at ${width}px`, async ({
    mount,
    page,
  }) => {
    const height = width === 960 ? 640 : width === 2560 ? 1440 : 960;
    await page.setViewportSize({ width, height });
    const component = await mount(KeyboardHelpHarness);
    const trigger = component.getByRole("button", { name: "Return focus here" });
    await trigger.focus();
    await page.keyboard.press("Control+/");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    const geometry = await dialog.evaluate((root) => {
      const body = root.querySelector<HTMLElement>(".modal-body");
      if (!body) throw new Error("Dialog body missing");
      const box = body.getBoundingClientRect();
      return {
        client: body.clientWidth,
        scroll: body.scrollWidth,
        keysVisible: [...body.querySelectorAll("kbd")].every((key) => {
          const keyBox = key.getBoundingClientRect();
          return keyBox.left >= box.left && keyBox.right <= box.right;
        }),
      };
    });
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    expect(geometry.keysVisible).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
