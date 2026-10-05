import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

// A CDP listener alone does not prove that Vue or the real Rust backend is ready.
// Connect to the existing main webview; never create a browser tab in Tauri.
// When the launcher passes an instance nonce, the webview must report the same one:
// otherwise a port collision could silently attach to another TracePilot instance.
export async function connectDesktop(endpoint, timeout = 30_000, instance = "") {
  const browser = await chromium.connectOverCDP(endpoint, { timeout });
  try {
    const deadline = Date.now() + timeout;
    let page;
    while (!page && Date.now() < deadline) {
      for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
        const identity = await candidate
          .evaluate(() => ({
            main:
              document.title === "TracePilot" &&
              window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "main",
            instance: window.__TRACEPILOT_AUTOMATION_INSTANCE__ ?? null,
          }))
          .catch(() => ({ main: false, instance: null }));
        if (!identity.main) continue;
        if (instance && identity.instance !== instance) {
          throw new Error(
            `Endpoint ${endpoint} belongs to another TracePilot instance (expected ${instance}, found ${identity.instance ?? "none"}).`,
          );
        }
        page = candidate;
        break;
      }
      if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!page) throw new Error("No TracePilot Tauri webview found at this endpoint.");
    await page
      .locator('[data-testid="app-sidebar"], [role="dialog"][aria-label="Setup Wizard"]')
      .first()
      .waitFor({ timeout });
    const installType = await page.evaluate(async () => {
      const result = await Promise.race([
        window.__TAURI_INTERNALS__.invoke("plugin:tracepilot|get_install_type"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Rust IPC probe timed out")), 10_000),
        ),
      ]);
      if (!["source", "installed", "portable"].includes(result))
        throw new Error("Unexpected install type from Rust IPC");
      return result;
    });
    return { browser, page, context: page.context(), installType };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { browser, installType } = await connectDesktop(process.argv[2], 30_000, process.argv[3]);
    console.log(`TracePilot ready: real Rust IPC verified (${installType} installation).`);
    await browser.close(); // Disconnect CDP; the app stays running.
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
