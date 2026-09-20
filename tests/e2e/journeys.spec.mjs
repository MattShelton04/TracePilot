import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { expect, sessionTab, setup, sidebar, test } from "./desktop.mjs";

test("first install: index, browse, search, refresh, and retain settings across restart", async ({
  desktop,
}) => {
  const [session, second, empty] = desktop.manifest.sessions;
  await desktop.start();
  let page = desktop.page;

  await test.step("complete setup and index the synthetic Copilot home", async () => {
    await setup(desktop, desktop.manifest.sessions.length);
    await sidebar(page, "Sessions");
    await expect(page.getByTestId("session-grid").getByRole("link")).toHaveCount(
      desktop.manifest.sessions.length - 1,
    );
    await expect(page.getByRole("heading", { name: session.title, exact: true })).toBeVisible();
    expect(existsSync(join(desktop.root, "tracepilot/index.db"))).toBe(true);
    expect(readFileSync(join(desktop.root, "tracepilot/config.toml"), "utf8")).toMatch(
      /setupComplete = true/,
    );
  });

  await test.step("filter the library, open a session, and inspect its real artifacts", async () => {
    const filter = page.getByTestId("session-search").getByRole("textbox");
    await filter.fill("no-such-orchard-session");
    await expect(page.getByText("No matching sessions", { exact: true })).toBeVisible();
    await filter.fill(session.title);
    await expect(page.getByTestId("session-grid").getByRole("link")).toHaveCount(1);
    await page.getByRole("link", { name: new RegExp(session.title) }).click();
    await expect(page.getByRole("heading", { name: "Orchard implementation plan" })).toBeVisible();

    await sessionTab(page, "Conversation");
    await expect(
      page.getByText(`Please investigate ${session.searchTerm} and add regression tests.`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/help you refactor module 0\. Let me read the relevant files first\./),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^read_file\b/ })
      .first()
      .click();
    await expect(
      page.getByText("Tool read_file completed successfully for tc-0-0", { exact: true }),
    ).toBeVisible();
    await sessionTab(page, "Events");
    await expect(page.getByText(`${session.events} total events`, { exact: true })).toBeVisible();
    await expect(page.getByRole("table")).toContainText("session.start");
    await sessionTab(page, "Todos");
    await expect(page.getByRole("progressbar", { name: "1 of 2 todos completed" })).toBeVisible();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(
      page.getByText("Add orchard regression coverage", { exact: true }).first(),
    ).toBeVisible();
    await sessionTab(page, "Metrics");
    await expect(page.getByRole("group", { name: "Metrics breakdown" })).toBeVisible();
    await expect(page.getByText("claude-sonnet-4-20250514", { exact: true }).first()).toBeVisible();
    await sessionTab(page, "Explorer");
    await page.getByText("plan.md", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Orchard implementation plan" })).toBeVisible();
    await sessionTab(page, "Timeline");
    await expect(page.getByRole("heading", { name: "Session Timeline" })).toBeVisible();
    await page.getByRole("button", { name: "Waterfall", exact: true }).click();
    await expect(page.getByRole("button", { name: "Waterfall", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  await test.step("search indexed message content and follow a result back to its session", async () => {
    await sidebar(page, "Search");
    await page
      .getByRole("textbox", { name: "Search sessions", exact: true })
      .fill(session.searchTerm);
    const result = page.getByRole("link", { name: "View in session", exact: true });
    await expect(result.first()).toBeVisible();
    await result.first().click();
    await expect(page.getByRole("heading", { name: session.title, exact: true })).toBeVisible();
    await sessionTab(page, "Conversation");
    await expect(
      page.getByText(`Please investigate ${session.searchTerm} and add regression tests.`, {
        exact: true,
      }),
    ).toBeVisible();
  });

  await test.step("refresh after Copilot appends a completed conversation turn", async () => {
    const event = (type, data, n) =>
      JSON.stringify({ id: `e2e-append-${n}`, type, timestamp: `2025-01-02T00:00:0${n}Z`, data });
    appendFileSync(
      join(desktop.root, "copilot/session-state", session.id, "events.jsonl"),
      `${[
        event("user.message", { content: "New orchard question after opening the session" }, 1),
        event("assistant.turn_start", { turnId: "e2e-appended-turn" }, 2),
        event(
          "assistant.message",
          { content: "Fresh orchard response from disk", messageId: "e2e-appended-message" },
          3,
        ),
        event("assistant.turn_end", { turnId: "e2e-appended-turn" }, 4),
      ].join("\n")}\n`,
    );
    await page.getByRole("button", { name: "Refresh data", exact: true }).click();
    await expect(page.getByText("Fresh orchard response from disk", { exact: true })).toBeVisible();
    await sessionTab(page, "Events");
    await expect(
      page.getByText(`${session.events + 4} total events`, { exact: true }),
    ).toBeVisible();
  });

  await test.step("open two session tabs, switch independently, and close them", async () => {
    for (const item of [session, second]) {
      await sidebar(page, "Sessions");
      await page.getByTestId("session-search").getByRole("textbox").fill(item.title);
      await page
        .getByRole("link", { name: new RegExp(item.title) })
        .click({ modifiers: ["Control"] });
      await expect(page.getByRole("tab", { name: item.title, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await sessionTab(page, "Conversation");
    }
    for (const item of [session, second]) {
      await page.getByRole("tab", { name: item.title, exact: true }).click();
      await expect(
        page.getByText(`Please investigate ${item.searchTerm} and add regression tests.`, {
          exact: true,
        }),
      ).toBeVisible();
    }
    await page.getByRole("button", { name: `Close ${second.title}`, exact: true }).click();
    await expect(page.getByRole("tab", { name: session.title, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("button", { name: `Close ${session.title}`, exact: true }).click();
    await expect(page.getByRole("tab", { name: session.title, exact: true })).toHaveCount(0);
  });

  await test.step("settings change the library and persist to config on disk", async () => {
    await sidebar(page, "Settings");
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await page.getByRole("switch", { name: "Hide empty sessions", exact: true }).uncheck();
    await expect
      .poll(() => readFileSync(join(desktop.root, "tracepilot/config.toml"), "utf8"))
      .toMatch(/hideEmptySessions = false/);
    await expect
      .poll(() => readFileSync(join(desktop.root, "tracepilot/config.toml"), "utf8"))
      .toMatch(/theme = "light"/);
    await sidebar(page, "Sessions");
    await page.getByTestId("session-search").getByRole("textbox").fill("");
    await expect(page.getByRole("heading", { name: empty.title, exact: true })).toBeVisible();
  });

  await test.step("restart the process and recover the index, settings, and session data", async () => {
    await desktop.restart();
    page = desktop.page;
    await expect(page.getByRole("dialog", { name: "Setup Wizard" })).toBeHidden();
    await sidebar(page, "Settings");
    await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByRole("switch", { name: "Hide empty sessions", exact: true }),
    ).not.toBeChecked();
    await sidebar(page, "Sessions");
    await expect(page.getByTestId("session-grid").getByRole("link")).toHaveCount(
      desktop.manifest.sessions.length,
    );
    await page.getByRole("link", { name: new RegExp(second.title) }).click();
    await sessionTab(page, "Conversation");
    await expect(
      page.getByText(`Please investigate ${second.searchTerm} and add regression tests.`, {
        exact: true,
      }),
    ).toBeVisible();
  });

  await test.step("common navigation remains usable at minimum and large desktop sizes", async () => {
    for (const [width, height] of [
      [960, 640],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width, height });
      await sessionTab(page, "Explorer");
      await expect(page.getByText("events.jsonl", { exact: true })).toBeVisible();
      await sidebar(page, "Settings");
      await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
      await sidebar(page, "Sessions");
      await page.getByRole("link", { name: new RegExp(second.title) }).click();
    }
  });
});

test("empty first run discovers a session created later", async ({ desktop }) => {
  const sessions = join(desktop.root, "copilot/session-state");
  const staged = join(desktop.root, "staged-sessions");
  renameSync(sessions, staged);
  mkdirSync(sessions);
  await desktop.start();
  await setup(desktop, 0);
  const page = desktop.page;
  await sidebar(page, "Sessions");
  await expect(page.getByText("No sessions yet", { exact: true })).toBeVisible();
  const [session] = desktop.manifest.sessions;
  cpSync(join(staged, session.id), join(sessions, session.id), { recursive: true });
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.getByTestId("session-grid").getByRole("link")).toHaveCount(1);
  await page.getByRole("link", { name: new RegExp(session.title) }).click();
  await sessionTab(page, "Conversation");
  await expect(
    page.getByText(`Please investigate ${session.searchTerm} and add regression tests.`, {
      exact: true,
    }),
  ).toBeVisible();
});
