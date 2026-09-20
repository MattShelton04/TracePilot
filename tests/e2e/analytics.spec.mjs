import { expect, setup, sidebar, test } from "./desktop.mjs";

test("bulk indexing feeds analytics, repository/date filters, tools, and code impact", async ({
  desktop,
}) => {
  await desktop.start();
  const page = desktop.page;
  const sessions = desktop.manifest.sessions.filter((session) => session.turns > 0);
  const totalTokens = sessions.reduce((sum, session) => sum + session.tokens, 0);
  const completedTurns = sessions
    .filter((session) => session.completed)
    .reduce((sum, session) => sum + session.turns, 0);
  const totalTools = sessions.reduce((sum, session) => sum + session.toolCalls, 0);
  const failures = sessions.reduce((sum, session) => sum + session.failedTools, 0);
  const metric = (name) => page.getByRole("group", { name, exact: true });
  const number = (value) => value.toLocaleString("en-US");
  const expectMetric = async (name, value) => {
    await expect(metric(name).getByText(String(value), { exact: true })).toBeVisible();
  };

  await test.step("index the complete corpus from first-run setup", async () => {
    await setup(desktop, desktop.manifest.sessions.length);
    await expect(page.getByTestId("session-grid").getByRole("link")).toHaveCount(sessions.length);
  });

  await test.step("analytics aggregate all nonempty sessions and three models", async () => {
    await sidebar(page, "Analytics");
    await page.getByRole("button", { name: "All Time", exact: true }).click();
    await expectMetric("Total Sessions", sessions.length);
    await expectMetric("Total Tokens", `${Number((totalTokens / 1_000_000).toFixed(1))}M`);
    for (const model of new Set(sessions.map((session) => session.model))) {
      await expect(page.getByText(model, { exact: true }).first()).toBeVisible();
    }
  });

  await test.step("repository filtering narrows analytics to fixture membership", async () => {
    const repository = "github.com/example/bulk-1";
    const count = sessions.filter((session) => session.repository === repository).length;
    await page.getByRole("combobox", { name: "Filter by repository" }).selectOption(repository);
    await expectMetric("Total Sessions", count);
    await page.getByRole("combobox", { name: "Filter by repository" }).selectOption("");
    await expectMetric("Total Sessions", sessions.length);
  });

  await test.step("date bounds select a known subset, handle no data, and recover totals", async () => {
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    await page.getByLabel("From date", { exact: true }).fill("2025-04-01");
    await page.getByLabel("From date", { exact: true }).blur();
    await expectMetric(
      "Total Sessions",
      sessions.filter((session) => session.date >= "2025-04-01").length,
    );
    await page.getByLabel("To date", { exact: true }).fill("2025-06-30");
    await page.getByLabel("To date", { exact: true }).blur();
    const quarter = sessions.filter(
      (session) => session.date >= "2025-04-01" && session.date <= "2025-06-30",
    );
    await expectMetric("Total Sessions", quarter.length);
    await page.getByLabel("To date", { exact: true }).fill("");
    await page.getByLabel("To date", { exact: true }).blur();
    await page.getByLabel("From date", { exact: true }).fill("2090-01-01");
    await page.getByLabel("From date", { exact: true }).blur();
    await expectMetric("Total Sessions", 0);
    await page.getByRole("button", { name: "All Time", exact: true }).click();
    await expectMetric("Total Sessions", sessions.length);
  });

  await test.step("tool analysis reads tool events across the corpus", async () => {
    await sidebar(page, "Tools");
    await expectMetric("Total Tool Calls", number(totalTools));
    await expectMetric(
      "Success Rate",
      `${Number(((1 - failures / totalTools) * 100).toFixed(1))}%`,
    );
    await expect(page.getByRole("table")).toContainText("read_file");
    await page
      .getByRole("combobox", { name: "Filter by repository" })
      .selectOption("github.com/example/orchard");
    await expectMetric("Total Tool Calls", 12);
  });

  await test.step("code impact aggregates shutdown metrics and respects repository scope", async () => {
    await sidebar(page, "Code");
    await expectMetric("Lines Added", "+60");
    await expectMetric("Lines Removed", "-18");
    await page.getByRole("combobox", { name: "Filter by repository" }).selectOption("");
    await expectMetric("Lines Added", `+${number(completedTurns * 10)}`);
  });
});
