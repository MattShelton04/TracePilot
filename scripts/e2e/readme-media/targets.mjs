import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { navigateTo } from "../connect.mjs";

export function buildCaptureConfig(args, defaultSessionId) {
  return {
    overviewSessionId: args.overviewSession ?? defaultSessionId,
    conversationSessionId: args.conversationSession ?? defaultSessionId,
    conversationTurn: parseTurn(args.conversationTurn),
    timelineSessionId: args.timelineSession ?? defaultSessionId,
    timelineTurn: parseTurn(args.timelineTurn),
    todosSessionId: args.todosSession ?? defaultSessionId,
    explorerSessionId: args.explorerSession ?? defaultSessionId,
    metricsSessionId: args.metricsSession ?? defaultSessionId,
  };
}

export function buildTargets(captureConfig, searchTerm) {
  return [
    pageTarget("session-list", "Session library", "/", "readme-session-list.png", {
      readme: true,
      waitMs: 2200,
      ready: (page) => waitForAny(page, ['[data-testid="session-grid"]', ".grid-cards"]),
    }),
    pageTarget(
      "session-overview",
      "Session overview",
      `/session/${captureConfig.overviewSessionId}/overview`,
      "readme-session-overview.png",
      { waitMs: 2200, ready: waitForDetailContent },
    ),
    pageTarget(
      "conversation",
      "Conversation",
      `/session/${captureConfig.conversationSessionId}/conversation`,
      "readme-conversation.png",
      {
        readme: true,
        waitMs: 2600,
        prepare: (page) => prepareConversation(page, captureConfig.conversationTurn),
        ready: (page) =>
          waitForAny(page, [
            ".cv-root",
            ".cv-stream",
            ".turn-group",
            ".compact-turn",
            '[data-testid="session-detail-content"]',
          ]),
      },
    ),
    pageTarget(
      "session-explorer",
      "Session explorer",
      `/session/${captureConfig.explorerSessionId}/explorer`,
      "readme-session-explorer.png",
      { waitMs: 1800, ready: waitForDetailContent },
    ),
    pageTarget(
      "todos",
      "Todos",
      `/session/${captureConfig.todosSessionId}/todos`,
      "readme-todos.png",
      {
        waitMs: 2200,
        prepare: prepareTodos,
        ready: (page) =>
          waitForAny(page, [
            ".todo-graph",
            ".todo-item",
            ".empty-state",
            '[data-testid="session-detail-content"]',
          ]),
      },
    ),
    pageTarget(
      "timeline",
      "Timeline",
      `/session/${captureConfig.timelineSessionId}/timeline`,
      "readme-timeline.png",
      {
        readme: true,
        waitMs: 2600,
        prepare: (page) => prepareTimeline(page, captureConfig.timelineTurn),
        ready: (page) => waitForAny(page, [".agent-tree", ".timeline-header", ".swimlanes-view"]),
      },
    ),
    pageTarget(
      "metrics",
      "Metrics",
      `/session/${captureConfig.metricsSessionId}/metrics`,
      "readme-metrics.png",
      {
        waitMs: 2200,
        ready: waitForDetailContent,
      },
    ),
    pageTarget("search", "Search", "/search", "readme-search.png", {
      readme: true,
      waitMs: 2200,
      prepare: (page) => prepareSearch(page, searchTerm),
      ready: (page) => waitForAny(page, ['[data-testid="search-input"]']),
    }),
    textTarget(
      "analytics",
      "Analytics dashboard",
      "/analytics",
      "readme-analytics.png",
      /Analytics|Dashboard|Tokens|Sessions/i,
      {
        readme: true,
        waitMs: 2800,
      },
    ),
    textTarget(
      "tool-analysis",
      "Tool analysis",
      "/tools",
      "readme-tool-analysis.png",
      /Tool|Success|Duration|Heatmap/i,
      {
        readme: true,
      },
    ),
    textTarget(
      "code-impact",
      "Code impact",
      "/code",
      "readme-code-impact.png",
      /Code|Files|Churn|Impact/i,
    ),
    textTarget(
      "model-comparison",
      "Model comparison",
      "/models",
      "readme-model-comparison.png",
      /Model|Cost|Cache|Token/i,
    ),
    pageTarget("orchestration", "Command Centre", "/orchestration", "readme-orchestration.png", {
      readme: true,
      waitMs: 2200,
      ready: (page) => waitForAny(page, ['[data-testid="orchestration-actions"]']),
    }),
    textTarget(
      "launcher",
      "Session Launcher",
      "/orchestration/launcher",
      "readme-launcher.png",
      /Launcher|Repository|Prompt|Model/i,
      {
        readme: true,
      },
    ),
    textTarget(
      "worktrees",
      "Worktree Manager",
      "/orchestration/worktrees",
      "readme-worktrees.png",
      /Worktree|Repository|Branch|Create/i,
      {
        readme: true,
      },
    ),
    textTarget(
      "config-injector",
      "Config Injector",
      "/orchestration/config",
      "readme-config-injector.png",
      /Config Injector|Agent Models|Backups/i,
      { readme: true, waitMs: 2600 },
    ),
    textTarget(
      "skills",
      "Skills Manager",
      "/skills",
      "readme-skills.png",
      /Skills|Import|Create|Editor/i,
      {
        optional: true,
      },
    ),
    textTarget("mcp", "MCP Server Manager", "/mcp", "readme-mcp.png", /MCP|Server|Health|Import/i, {
      optional: true,
    }),
  ];
}

export async function captureTarget(page, context, target, viewport, options) {
  const { candidateRoot, docsImagesDir, finalViewport, warn } = options;
  const targetDir = resolve(candidateRoot, viewport.label);
  mkdirSync(targetDir, { recursive: true });

  const candidatePath = resolve(targetDir, target.fileName);
  const record = {
    key: target.key,
    title: target.title,
    route: target.route,
    viewport: viewport.label,
    candidatePath,
    finalPath: null,
    readme: target.readme,
    status: "pending",
  };

  try {
    await resizeForCapture(page, context, viewport, warn);
    await navigateTo(page, target.route);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.style.scrollBehavior = "auto";
    });

    if (target.ready) await target.ready(page);
    if (target.prepare) await target.prepare(page);
    await page.waitForTimeout(target.waitMs ?? 1500);

    await page.screenshot({ path: candidatePath, fullPage: false, animations: "disabled" });
    record.status = "captured";

    if (viewport.label === finalViewport) {
      const finalPath = resolve(docsImagesDir, target.fileName);
      copyFileSync(candidatePath, finalPath);
      record.finalPath = finalPath;
    }
  } catch (error) {
    record.status = target.optional ? "skipped" : "failed";
    record.error = error.message;
    warn(
      `${target.optional ? "Skipped" : "Failed"} ${target.key} at ${viewport.label}: ${error.message}`,
    );
    if (!target.optional) throw error;
  }

  return record;
}

function pageTarget(key, title, route, fileName, overrides = {}) {
  return {
    key,
    title,
    route,
    fileName,
    waitMs: 2400,
    readme: false,
    ...overrides,
  };
}

function textTarget(key, title, route, fileName, pattern, overrides = {}) {
  return pageTarget(key, title, route, fileName, {
    waitMs: 2400,
    ready: (page) => waitForPageText(page, pattern),
    ...overrides,
  });
}

async function resizeForCapture(page, context, viewport, warn) {
  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        width: viewport.width,
        height: viewport.height,
        windowState: "normal",
      },
    });
    await cdp.detach();
    await sleep(500);
  } catch (error) {
    warn(`Native window resize failed for ${viewport.label}; falling back to viewport only.`, {
      error: error.message,
    });
  }

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
}

async function waitForDetailContent(page) {
  await waitForAny(page, ['[data-testid="session-detail-content"]']);
}

async function waitForAny(page, selectors, timeout = 5000) {
  const locators = selectors.map((selector) =>
    page.locator(selector).first().waitFor({ state: "visible", timeout }),
  );
  await Promise.any(locators);
}

async function waitForPageText(page, pattern, timeout = 5000) {
  await page.waitForFunction(
    (source) => new RegExp(source, "i").test(document.body?.innerText ?? ""),
    pattern.source,
    { timeout },
  );
}

async function clickButtonByText(page, label) {
  const button = page.getByRole("button", {
    name: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, "i"),
  });
  if ((await button.count()) > 0) await button.first().click();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function prepareSearch(page, searchTerm) {
  const input = page
    .locator('[data-testid="search-input"], [data-testid="search-input-field"]')
    .first();
  if ((await input.count()) === 0) return;
  await input.fill(searchTerm);
  await page.waitForTimeout(1800);
}

async function prepareConversation(page, turnIndex) {
  await clickButtonByText(page, "Chat");
  await page.waitForTimeout(400);
  await scrollToTurn(page, turnIndex);
}

async function prepareTimeline(page, turnIndex) {
  await clickButtonByText(page, "Agent Tree");
  await page.waitForTimeout(500);
  await jumpAgentTreeToTurn(page, turnIndex);
}

async function prepareTodos(page) {
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const graph = document.querySelector(".todo-dependency-graph, .todo-graph, svg");
    graph?.scrollIntoView({ block: "center", inline: "nearest" });
  });
  await page.waitForTimeout(400);
}

async function scrollToTurn(page, turnIndex) {
  if (turnIndex == null) return;
  const target = page.locator(`[data-turn-idx="${turnIndex}"]`).first();
  if ((await target.count()) === 0) return;
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
}

async function jumpAgentTreeToTurn(page, turnIndex) {
  if (turnIndex == null) return;
  const label = page.locator(".turn-nav-label").first();
  if ((await label.count()) === 0) return;

  await page
    .getByRole("button", { name: /earliest/i })
    .click()
    .catch(() => {});
  await sleep(200);

  for (let i = 0; i < 80; i++) {
    const text = await label.textContent().catch(() => "");
    if (new RegExp(`Turn\\s+${turnIndex}\\b`).test(text ?? "")) return;

    const next = page.getByRole("button", { name: /next/i }).first();
    if ((await next.count()) === 0 || !(await next.isEnabled().catch(() => false))) break;
    await next.click();
    await sleep(120);
  }
}

function parseTurn(value) {
  if (value == null || value === "") return null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}
