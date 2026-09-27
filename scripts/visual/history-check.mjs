// Browser assertions shared by the existing visual gallery check.
import assert from "node:assert/strict";
import { renderHistory } from "./gallery-template.mjs";

export async function checkHistory(page) {
  const overview = ["sessions", ...Array.from({ length: 7 }, (_, i) => `overview-${i}`)];
  const tools = Array.from({ length: 27 }, (_, i) => `rich-tool-fixture-${i}`);
  const views = [...overview, ...tools];
  const images = Object.fromEntries(views.map((view) => [view, `${"a".repeat(64)}.png`]));
  const changes = Object.fromEntries(views.map((view) => [view, "changed"]));
  for (const view of tools.slice(22, 24)) changes[view] = "subtle";
  for (const view of tools.slice(24, 26)) changes[view] = "incomplete";
  changes[tools[26]] = "base unavailable";
  const entry = {
    id: 200,
    sha: "b".repeat(40),
    created: "2026-09-26T12:00:00Z",
    pr: 854,
    views,
    images,
    changes,
    summary: { changed: 30, subtle: 2, incomplete: 2, baseUnavailable: 1, unchanged: 0, total: 35 },
  };
  const html = await renderHistory([entry, { ...entry, id: 199, pr: null }]);
  const imageRoute = "**/img/*.png";
  const imageHandler = (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7QAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  await page.route(imageRoute, imageHandler);
  try {
    await page.evaluate(() => history.replaceState(null, "", location.pathname));
    await page.setContent(html);
    const previews = page.locator("#pr-list .preview");
    assert.equal(await previews.count(), 3);
    assert.ok(
      (await previews.locator(".preview-label").allTextContents()).every((id) =>
        overview.includes(id),
      ),
    );
    assert.equal(await page.locator("#pr-list .more-views:not(.detail-sections) .chip").count(), 1);
    assert.equal(await page.locator("#pr-list .detail-sections .chip").count(), 1);
    const rich = page.locator('#pr-list [data-section="rich-tools"]');
    assert.match(await rich.innerText(), /27 views · 22 review · 2 subtle · 3 limitations/);
    assert.match(await rich.getAttribute("href"), /#view=rich-tool-fixture-0&mode=difference$/);
    const groups = page.locator("#timeline-view optgroup");
    assert.equal(await groups.count(), 2);
    assert.deepEqual(
      await groups.evaluateAll((nodes) => nodes.map((group) => group.children.length)),
      [8, 27],
    );
    for (const [width, height] of [
      [1440, 960],
      [960, 640],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width, height });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
    await page.getByRole("tab", { name: "Main", exact: true }).click();
    assert.equal(await page.locator("#main-list .preview").count(), 4);
    assert.equal(await page.locator("#main-list .detail-sections .chip").count(), 1);

    // Older history links only had a view hash. Keep those opening the timeline.
    await page.evaluate(
      (view) => history.replaceState(null, "", `#view=${view}&scope=all`),
      tools[0],
    );
    await page.setContent(html);
    assert.equal(
      await page.getByRole("tab", { name: "View timeline" }).getAttribute("aria-selected"),
      "true",
    );
    assert.equal(await page.locator("#timeline-view").inputValue(), tools[0]);
    assert.equal(await page.locator("#timeline-scope").inputValue(), "all");
    assert.equal(await page.locator(".timeline-card").count(), 1);
    assert.match(await page.locator(".timeline-info").innerText(), /Same pixels in 1 earlier run/);
    await page.locator("#timeline-view").selectOption(overview[0]);
    assert.match(page.url(), /view=sessions/);
    return { sections: 2, overviewPreviews: [3, 4], detailLinksPerRun: 1, timelineDeepLink: true };
  } finally {
    await page.unroute(imageRoute, imageHandler);
  }
}
