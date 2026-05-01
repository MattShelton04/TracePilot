import { expect, test } from "@playwright/experimental-ct-vue";
import PageHeader from "../components/PageHeader.vue";
import { SNAPSHOT_OPTS } from "./index";

const actionButton =
  "border:1px solid var(--border-default);border-radius:6px;" +
  "background:var(--surface-secondary);color:var(--text-secondary);" +
  "padding:4px 10px;font:inherit;font-size:12px;";

const primaryActionButton =
  "border:1px solid var(--accent-fg);border-radius:6px;" +
  "background:var(--accent-muted);color:var(--accent-fg);" +
  "padding:4px 10px;font:inherit;font-size:12px;";

test.describe("PageHeader", () => {
  test("composite header", async ({ mount }) => {
    const component = await mount(PageHeader, {
      props: {
        title: "Session overview",
        subtitle: "3 active agents",
        inlineSubtitle: true,
        size: "lg",
      },
      slots: {
        icon: `
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5zM4 5v1.5h8V5zm0 3v1.5h5V8z"
            />
          </svg>
        `,
        actions: `
          <button style="${actionButton}">Export</button>
          <button style="${primaryActionButton}">Refresh</button>
        `,
      },
    });

    await expect(component).toHaveScreenshot("composite.png", SNAPSHOT_OPTS);
  });
});
