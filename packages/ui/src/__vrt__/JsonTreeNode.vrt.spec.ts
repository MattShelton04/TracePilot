import { expect, test } from "@playwright/experimental-ct-vue";
import JsonTreeNode from "../components/file-viewers/JsonTreeNode.vue";

// Geometry assertions avoid font/OS-sensitive screenshots. These exercise the
// actual shared component in Chromium; native desktop consumers still need QA.
const longValue = "SanitizedUnbrokenValue".repeat(1400);

test.describe("JSON tree long scalar layout", () => {
  test.use({ viewport: { width: 960, height: 640 } });

  test("keeps a short key readable beside a very long scalar", async ({ mount }) => {
    const component = await mount(JsonTreeNode, {
      props: { value: { instructions: longValue }, expandAll: true },
    });
    await component.evaluate((root) => {
      root.style.width = "584px";
    });
    const geometry = await component.evaluate((root) => {
      const scalar = root.querySelector<HTMLElement>(".json-node__scalar")!;
      const key = scalar.previousElementSibling as HTMLElement;
      return {
        keyWidth: key.getBoundingClientRect().width,
        keyHeight: key.getBoundingClientRect().height,
        fontSize: Number.parseFloat(getComputedStyle(key).fontSize),
        scalarRight: scalar.getBoundingClientRect().right,
        rowRight: scalar.parentElement!.getBoundingClientRect().right,
        scrollWidth: root.scrollWidth,
        width: root.clientWidth,
      };
    });
    expect(geometry.keyWidth).toBeGreaterThan(geometry.fontSize * 6);
    expect(geometry.keyHeight).toBeLessThanOrEqual(geometry.fontSize * 2);
    expect(geometry.scalarRight).toBeLessThanOrEqual(geometry.rowRight + 1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  });

  test("puts a long value below its readable key when nesting leaves a narrow row", async ({
    mount,
  }) => {
    const component = await mount(JsonTreeNode, {
      props: { value: { outer: { inner: { instructions: longValue } } }, expandAll: true },
    });
    await component.evaluate((root) => {
      root.style.width = "220px";
    });
    const geometry = await component.evaluate((root) => {
      const scalar = root.querySelector<HTMLElement>(".json-node__scalar")!;
      const key = scalar.previousElementSibling as HTMLElement;
      return {
        keyWidth: key.getBoundingClientRect().width,
        keyBottom: key.getBoundingClientRect().bottom,
        scalarTop: scalar.getBoundingClientRect().top,
        scalarWidth: scalar.getBoundingClientRect().width,
        scrollWidth: root.scrollWidth,
        width: root.clientWidth,
      };
    });
    expect(geometry.keyWidth).toBeGreaterThan(60);
    expect(geometry.scalarTop).toBeGreaterThanOrEqual(geometry.keyBottom);
    expect(geometry.scalarWidth).toBeGreaterThan(100);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  });

  test("wraps long Unicode keys and unbroken values without overflowing the tree or page", async ({
    mount,
    page,
  }) => {
    const longKey = "長いキー_αβγ_property_".repeat(15);
    const component = await mount(JsonTreeNode, {
      props: { value: { [longKey]: { [longKey]: longValue } }, expandAll: true },
    });
    await component.evaluate((root) => {
      root.style.width = "220px";
    });
    const geometry = await component.evaluate((root) => ({
      scrollWidth: root.scrollWidth,
      width: root.clientWidth,
      keys: [...root.querySelectorAll<HTMLElement>(".json-node__key")].map((key) => ({
        width: key.getBoundingClientRect().width,
        text: key.textContent,
      })),
    }));
    expect(geometry.keys.every((key) => key.width > 60 && key.text === longKey)).toBe(true);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(await component.locator(".json-node__scalar").textContent()).toBe(
      JSON.stringify(longValue),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      960,
    );
  });
});
