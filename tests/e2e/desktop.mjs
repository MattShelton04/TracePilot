import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test as base, expect } from "@playwright/test";
import { connectDesktop } from "../../scripts/automation/ready.mjs";

const execute = promisify(execFile);
const repo = resolve(import.meta.dirname, "../..");

export const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  desktop: async ({}, use, info) => {
    assert.equal(process.platform, "win32", "Native E2E requires Windows + WebView2");
    const output = info.outputPath("native");
    mkdirSync(output, { recursive: true });
    const root = join(output, "data root"); // Exercise Windows paths containing spaces.
    const stateDirectory = join(output, "lifecycle");
    const executable = resolve(
      process.env.TRACEPILOT_E2E_EXECUTABLE || join(repo, "target/release/tracepilot-desktop.exe"),
    );
    const generator = resolve(
      process.env.TRACEPILOT_E2E_GENERATOR || join(repo, "target/release/examples/e2e_fixture.exe"),
    );
    await execute(generator, [root], { windowsHide: true, timeout: 30_000 });
    assert(!existsSync(join(root, "tracepilot/config.toml")));
    assert(!existsSync(join(root, "tracepilot/index.db")));
    const manifest = JSON.parse(readFileSync(join(root, "fixture.json"), "utf8"));
    const errors = [];
    const consoleLog = [];
    let connection;
    let generation = 0;
    async function lifecycle(action) {
      const args = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(repo, "scripts/automation/app.ps1"),
        action,
        "-StateDirectory",
        stateDirectory,
      ];
      if (action === "start")
        args.push(
          "-Runtime",
          "production",
          "-SkipBuild",
          "-Executable",
          executable,
          "-DataRoot",
          root,
          "-TimeoutSeconds",
          "60",
        );
      try {
        const result = await execute("powershell.exe", args, {
          cwd: repo,
          windowsHide: true,
          timeout: 90_000,
        });
        appendFileSync(join(output, "lifecycle.log"), result.stdout + result.stderr);
      } catch (error) {
        appendFileSync(join(output, "lifecycle.log"), `${error.stdout}\n${error.stderr}\n${error}`);
        throw error;
      }
    }
    async function disconnect() {
      if (!connection) return;
      try {
        await connection.page.screenshot({ path: join(output, `desktop-${generation}.png`) });
        writeFileSync(
          join(output, `snapshot-${generation}.yml`),
          await connection.page.locator("body").ariaSnapshot(),
        );
        await connection.context.tracing.stop({ path: join(output, `trace-${generation}.zip`) });
        await info.attach(`Native trace ${generation}`, {
          path: join(output, `trace-${generation}.zip`),
          contentType: "application/zip",
        });
        await info.attach(`Desktop ${generation}`, {
          path: join(output, `desktop-${generation}.png`),
          contentType: "image/png",
        });
      } finally {
        await connection.browser.close();
        connection = undefined;
      }
    }
    const desktop = {
      root,
      manifest,
      get page() {
        assert(connection, "Call desktop.start() first");
        return connection.page;
      },
      async start() {
        await lifecycle("start");
        const state = JSON.parse(readFileSync(join(stateDirectory, "desktop.json"), "utf8"));
        assert.equal(state.dataRoot.toLowerCase(), root.toLowerCase());
        assert.equal(state.build.executable.toLowerCase(), executable.toLowerCase());
        connection = await connectDesktop(state.endpoint);
        generation++;
        await connection.context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true,
        });
        connection.page.on("pageerror", (error) => errors.push(String(error)));
        connection.page.on("console", (message) =>
          consoleLog.push({ type: message.type(), text: message.text() }),
        );
        connection.page.setDefaultTimeout(20_000);
        await connection.page.setViewportSize({ width: 1440, height: 960 });
        await connection.page.emulateMedia({ reducedMotion: "reduce" });
      },
      async restart() {
        await disconnect();
        await lifecycle("stop");
        await desktop.start();
      },
    };
    try {
      await use(desktop);
      expect(errors, "Uncaught webview errors").toEqual([]);
    } finally {
      try {
        await disconnect();
      } finally {
        await lifecycle("stop");
        writeFileSync(
          join(output, "console.json"),
          JSON.stringify({ errors, messages: consoleLog }, null, 2),
        );
      }
    }
  },
});

export { expect };

export async function setup(desktop, count) {
  const page = desktop.page;
  const wizard = page.getByRole("dialog", { name: "Setup Wizard" });
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: /Begin Setup/ }).click();
  await wizard.getByRole("button", { name: /Continue/ }).click();
  await expect(wizard.getByRole("textbox", { name: "Copilot home directory" })).toHaveValue(
    join(desktop.root, "copilot"),
  );
  await expect(wizard.getByRole("status")).toContainText(
    count ? `Found ${count} sessions` : "No sessions found yet",
  );
  await wizard.getByRole("button", { name: /Continue/ }).click();
  await expect(wizard.getByRole("textbox", { name: "TracePilot data directory" })).toHaveValue(
    join(desktop.root, "tracepilot"),
  );
  await wizard.getByRole("button", { name: /Continue/ }).click();
  await wizard.getByRole("button", { name: "Launch TracePilot" }).click();
  await expect(wizard).toBeHidden();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

export async function sidebar(page, name) {
  await page
    .getByTestId("app-sidebar")
    .getByRole("link", { name: new RegExp(`^${name}(?:\\s|$)`) })
    .click();
}

export async function sessionTab(page, name) {
  const tab = page.getByRole("tab", { name: new RegExp(`^${name}(?:\\s|$)`) });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
