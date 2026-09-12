/**
 * Audit-only file-picker result substitution for an already attached Tauri app.
 * This is NOT native-dialog coverage: OS presentation, overwrite prompts and
 * picker-granted filesystem/asset scopes remain untested. All TracePilot Rust
 * commands continue through their original IPC transport.
 *
 * Contract checked against installed Tauri 2.10.3 scripts/core.js and
 * scripts/ipc-protocol.js, and @tauri-apps/plugin-dialog/dist-js/index.js:
 * - invoke/ipc/postMessage are immutable; the custom protocol uses global fetch.
 * - open/save send { options } and resolve a path string (or null) here.
 * - JSON + Tauri-Response: ok/error chooses the original success/error callback.
 * Never reject a matched fetch: that would trigger Tauri's native IPC fallback.
 *
 * Caller MUST verify every non-null path belongs to disposable task data and
 * the configured import destination is isolated BEFORE running the workflow.
 * The browser cannot establish filesystem ownership or detect symlinks.
 * Use createNativeDialogRunCode() for CLI run-code --filename, or install with
 * page.evaluate() and ALWAYS restore with page.evaluate() in finally.
 */

/** Browser-serializable; no module-scope dependencies. Queue order is strict. */
export function installNativeDialogGateway(selections) {
  const key = "__TRACEPILOT_AUDIT_DIALOG_GATEWAY__";
  if (window[key]) throw new Error("An audit dialog gateway is already installed");
  const internals = window.__TAURI_INTERNALS__;
  if (
    window.isTauri !== true ||
    typeof internals?.convertFileSrc !== "function" ||
    typeof internals?.invoke !== "function"
  ) {
    throw new Error("Audit dialog gateway requires the real Tauri runtime");
  }
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 16) {
    throw new Error("Provide 1–16 explicitly queued picker selections");
  }
  const queue = selections.map((selection) => {
    if (
      !selection ||
      !["open", "save"].includes(selection.command) ||
      typeof selection.title !== "string" ||
      !selection.title.trim() ||
      selection.title.length > 200 ||
      (selection.path !== null &&
        (typeof selection.path !== "string" ||
          !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+[\\/]|\/)/i.test(selection.path) ||
          /\0|(?:^|[\\/])\.\.(?:[\\/]|$)/.test(selection.path)))
    ) {
      throw new Error(
        "Each selection needs open/save, an exact title, and an absolute path or null",
      );
    }
    return { command: selection.command, title: selection.title, path: selection.path };
  });
  const urls = new Map(
    ["open", "save"].map((command) => [
      internals.convertFileSrc(`plugin:dialog|${command}`, "ipc"),
      command,
    ]),
  );
  const probeUrl = internals.convertFileSrc("plugin:tracepilot|get_install_type", "ipc");
  const originalFetch = window.fetch;
  const trace = [];
  let consumed = 0;
  let blocked = 0;
  let forwarded = 0;
  let nativeProbeForwarded = 0;
  let active = true;
  let expiry;

  function snapshot() {
    return {
      mode: "picker-result-substitution",
      active,
      consumed,
      pending: queue.length - consumed,
      blocked,
      forwarded,
      nativeProbeForwarded,
      trace: trace.map((event) => ({ ...event })),
    };
  }

  function restore() {
    const stillOwnsFetch = window.fetch === gatewayFetch;
    if (stillOwnsFetch) window.fetch = originalFetch;
    active = false;
    clearTimeout(expiry);
    if (window[key]?.restore === restore) delete window[key];
    return {
      ...snapshot(),
      restored: stillOwnsFetch,
      originalFetchCurrent: window.fetch === originalFetch,
    };
  }

  function reply(value, success = true) {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json", "Tauri-Response": success ? "ok" : "error" },
    });
  }

  function gatewayFetch(...args) {
    const [input, init] = args;
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    const command = urls.get(url);
    if (!active || !command) {
      if (active) {
        forwarded += 1;
        if (url === probeUrl) nativeProbeForwarded += 1;
      }
      return Reflect.apply(originalFetch, this, args);
    }
    let payload;
    try {
      // Tauri 2.10.3 sends URL + init; Request objects or non-JSON bodies at an
      // exact dialog URL are unexpected contracts, not permission to guess.
      if (init?.method !== "POST" || typeof init.body !== "string") throw new Error();
      payload = JSON.parse(init.body);
    } catch {
      payload = null;
    }
    const expected = queue[consumed];
    const options = payload?.options;
    if (
      !expected ||
      command !== expected.command ||
      !options ||
      options.title !== expected.title ||
      options.multiple === true ||
      options.directory === true
    ) {
      blocked += 1;
      if (trace.length < 64) trace.push({ command, outcome: "blocked-unexpected-request" });
      return Promise.resolve(
        reply("Audit picker request did not match its queued single-file selection", false),
      );
    }
    consumed += 1;
    if (trace.length < 64) {
      trace.push({
        command,
        outcome: expected.path === null ? "substituted-cancel" : "substituted-path",
      });
    }
    return Promise.resolve(reply(expected.path));
  }

  window.fetch = gatewayFetch;
  if (window.fetch !== gatewayFetch) throw new Error("Cannot install audit fetch gateway");
  window[key] = { snapshot, restore };
  // A killed CLI workflow must not leave an indefinite picker substitution.
  expiry = setTimeout(restore, 120_000);
  return snapshot();
}

/** Browser-serializable cleanup, including after a failed or timed-out workflow. */
export function restoreNativeDialogGateway() {
  return (
    window.__TRACEPILOT_AUDIT_DIALOG_GATEWAY__?.restore() ?? {
      active: false,
      restored: false,
      reason: "Gateway was not installed or has expired",
    }
  );
}

/**
 * Return a standalone function for playwright-cli run-code --filename.
 * workflowSource must be a trusted, self-contained `async page => { ... }`.
 * It is code, not user data. Selections are serialized separately as data.
 * The read-only probe verifies that native IPC actually uses the intercepted
 * fetch transport before the workflow can click a picker. It is not substituted.
 * Successful runs return { result, gateway } with cleanup evidence in gateway.
 *
 * Example in an ignored task script:
 *   writeFileSync('.tracepilot/export-audit.cjs', createNativeDialogRunCode(
 *     [{ command: 'save', title: 'Save export as', path: ownedAbsolutePath }],
 *     'async page => { await page.getByRole("button", { name: "Export", exact: true }).click(); }',
 *   ));
 * Then: pnpm exec playwright-cli -s=tracepilot-desktop run-code --filename=.tracepilot/export-audit.cjs
 * Assert the visible result and persisted artifact in the supplied workflow.
 */
export function createNativeDialogRunCode(selections, workflowSource) {
  if (typeof workflowSource !== "string" || !workflowSource.trim()) {
    throw new Error("Provide a trusted, self-contained Playwright workflow function");
  }
  return `async page => {
    await page.evaluate(${installNativeDialogGateway.toString()}, ${JSON.stringify(selections)});
    let result;
    let gateway;
    let failed = false;
    try {
      await page.evaluate(async () => {
        await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|get_install_type', {});
        if (!window.__TRACEPILOT_AUDIT_DIALOG_GATEWAY__?.snapshot().nativeProbeForwarded) {
          throw new Error('Native IPC is not using fetch; picker substitution is unavailable');
        }
      });
      result = await (${workflowSource})(page);
      const status = await page.evaluate(() => window.__TRACEPILOT_AUDIT_DIALOG_GATEWAY__?.snapshot());
      if (!status?.active || status.pending || status.blocked) {
        throw new Error('Audit picker queue was not completed cleanly');
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        gateway = await page.evaluate(${restoreNativeDialogGateway.toString()});
      } catch (cleanupError) {
        if (!failed) throw cleanupError;
      }
    }
    return { result, gateway };
  }`;
}
