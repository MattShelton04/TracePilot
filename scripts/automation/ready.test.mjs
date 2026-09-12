import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright-core";
import { connectDesktop } from "./ready.mjs";

test("desktop readiness rejects browser mocks and disconnects on IPC failure", {
  skip: process.platform !== "win32",
}, async (t) => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: [`--remote-debugging-port=${port}`],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<title>TracePilot</title><nav data-testid="app-sidebar">Fixture</nav>');
  await page.evaluate(() => {
    window.__TRACEPILOT_READY__ = true;
    window.__TRACEPILOT_PERF__ = {};
  });
  const endpoint = `http://127.0.0.1:${port}`;
  await assert.rejects(connectDesktop(endpoint, 500), /No TracePilot Tauri webview/);
  assert.equal(browser.isConnected(), true);
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async () => {
        throw new Error("IPC unavailable");
      },
    };
  });
  await assert.rejects(connectDesktop(endpoint, 1000), /IPC unavailable/);
  assert.equal(await page.title(), "TracePilot");

  // First-time setup must not depend on an existing session directory/database.
  await page.setContent(
    '<title>TracePilot</title><div role="dialog" aria-label="Setup Wizard">Set up</div>',
  );
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__.invoke = async (command) => {
      if (command !== "plugin:tracepilot|get_install_type") throw new Error("Unexpected command");
      return "source";
    };
  });
  const connection = await connectDesktop(endpoint, 1000);
  assert.equal(connection.installType, "source");
  await connection.browser.close();
  assert.equal(await page.title(), "TracePilot");
});
