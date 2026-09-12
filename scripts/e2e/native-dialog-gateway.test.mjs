import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  createNativeDialogRunCode,
  installNativeDialogGateway,
  restoreNativeDialogGateway,
} from "./native-dialog-gateway.mjs";

const key = "__TRACEPILOT_AUDIT_DIALOG_GATEWAY__";
const ownedPath = "C:\\audit-fixture\\session.tpx.json";
const save = { command: "save", title: "Save export as", path: ownedPath };
const open = { command: "open", title: "Select TracePilot export file", path: ownedPath };
const convertFileSrc = (command, protocol) =>
  `http://${protocol}.localhost/${encodeURIComponent(command)}`;

function harness(t, { fetchFailure = false, fallbackTransport = false } = {}) {
  const requests = [];
  const timers = new Map();
  const forwarded = fetchFailure
    ? Promise.reject(new Error("Native transport failed"))
    : Promise.resolve(
        new Response(JSON.stringify("source"), {
          headers: { "Content-Type": "application/json", "Tauri-Response": "ok" },
        }),
      );
  if (fetchFailure) forwarded.catch(() => {});
  function originalFetch(...args) {
    requests.push({ args, receiver: this });
    return forwarded;
  }
  const window = { isTauri: true, fetch: originalFetch };
  const invoke = async (command, payload) => {
    if (fallbackTransport) return "source";
    const response = await window.fetch(convertFileSrc(command, "ipc"), {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Tauri-Invoke-Key": "test-secret-must-not-be-logged" },
    });
    const value = await response.json();
    if (response.headers.get("Tauri-Response") !== "ok") throw new Error(value);
    return value;
  };
  // Match the installed native runtime's immutable descriptors, not api/mocks.
  const internals = {};
  Object.defineProperties(internals, {
    convertFileSrc: { value: convertFileSrc },
    invoke: { value: invoke },
  });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: internals });
  const logs = [];
  const context = {
    window,
    Response,
    URL,
    Request,
    console: { log: (...args) => logs.push(args) },
    setTimeout: (callback, timeout) => {
      const id = timers.size + 1;
      timers.set(id, { callback, timeout });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const evaluate = (fn, argument) => {
    context.argument = argument;
    return runInNewContext(`(${fn.toString()})(argument)`, context);
  };
  const page = { evaluate };
  t.after(() => window[key]?.restore());
  return {
    window,
    internals,
    requests,
    originalFetch,
    forwarded,
    timers,
    evaluate,
    page,
    logs,
    context,
  };
}

function dialogRequest(window, selection, options = {}) {
  return window.fetch(convertFileSrc(`plugin:dialog|${selection.command}`, "ipc"), {
    method: "POST",
    body: JSON.stringify({ options: { title: selection.title, ...options } }),
  });
}

test("single-file save/open/cancel preserve the native response contract and immutable invoke", async (t) => {
  const h = harness(t);
  const invoke = h.internals.invoke;
  const queue = [{ ...save }, { ...open }, { ...open, path: null }];
  const status = h.evaluate(installNativeDialogGateway, queue);
  assert.equal(status.pending, 3);
  queue[0].path = "C:\\unexpected-after-install.json";
  for (const expected of [save, open, { ...open, path: null }]) {
    const response = await dialogRequest(h.window, expected);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Tauri-Response"), "ok");
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(await response.json(), expected.path);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.internals.invoke, invoke);
  assert.equal(Object.getOwnPropertyDescriptor(h.internals, "invoke").writable, false);
  const final = h.evaluate(restoreNativeDialogGateway);
  assert.equal(final.consumed, 3);
  assert.equal(final.pending, 0);
  assert.equal(final.restored, true);
  assert.equal(h.window.fetch, h.originalFetch);
  assert.equal(h.timers.size, 0);
  assert(!JSON.stringify(final).includes(ownedPath));
});

test("forwards native TracePilot IPC and unrelated URLs with exact arguments, receiver and promise", async (t) => {
  const h = harness(t);
  h.evaluate(installNativeDialogGateway, [save]);
  const inputs = [
    convertFileSrc("plugin:tracepilot|export_sessions", "ipc"),
    `${convertFileSrc("plugin:dialog|save", "ipc")}?unexpected=1`,
    "https://unrelated.test/plugin%3Adialog%7Csave",
    new Request("https://unrelated.test/file"),
    new URL("https://unrelated.test/asset"),
  ];
  for (const input of inputs) {
    const init = { method: "POST", body: "unchanged-body", headers: { authorization: "private" } };
    const receiver = {};
    const response = h.window.fetch.call(receiver, input, init);
    assert.equal(response, h.forwarded);
    const recorded = h.requests.at(-1);
    assert.equal(recorded.args[0], input);
    assert.equal(recorded.args[1], init);
    assert.equal(recorded.receiver, receiver);
  }
  const status = h.window[key].snapshot();
  assert.equal(status.forwarded, inputs.length);
  assert.equal(status.pending, 1);
  assert(!JSON.stringify(status).includes("private"));
  await h.forwarded;
});

test("rejects only exact dialog commands with mismatched, malformed or unsupported options without invoking native fallback", async (t) => {
  const h = harness(t);
  h.evaluate(installNativeDialogGateway, [save]);
  const url = convertFileSrc("plugin:dialog|save", "ipc");
  const responses = [
    await dialogRequest(h.window, open),
    await dialogRequest(h.window, { ...save, title: "Other title" }),
    await dialogRequest(h.window, save, { multiple: true }),
    await dialogRequest(h.window, save, { directory: true }),
    await h.window.fetch(url, { method: "POST", body: "not-json" }),
    await h.window.fetch(url, { method: "GET" }),
    await h.window.fetch(new Request(url)),
  ];
  for (const response of responses) {
    assert.equal(response.headers.get("Tauri-Response"), "error");
    assert.match(await response.json(), /did not match/);
  }
  assert.equal(h.window[key].snapshot().consumed, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(await (await dialogRequest(h.window, save)).json(), ownedPath);
  const duplicate = await dialogRequest(h.window, save);
  assert.equal(duplicate.headers.get("Tauri-Response"), "error");
  assert.equal(h.window[key].snapshot().consumed, 1);
  assert.equal(h.window[key].snapshot().blocked, 8);
});

test("validates a bounded explicit queue before changing the browser", (t) => {
  const h = harness(t);
  for (const selections of [
    [],
    new Array(17).fill(save),
    null,
    [{ ...save, command: "confirm" }],
    [{ ...save, title: " " }],
    [{ ...save, path: "relative.json" }],
    [{ ...save, path: "C:\\audit\\..\\other.json" }],
    [{ ...save, path: "C:\\audit\\bad\0.json" }],
    [{ ...save, path: undefined }],
  ]) {
    assert.throws(() => h.evaluate(installNativeDialogGateway, selections));
    assert.equal(h.window.fetch, h.originalFetch);
    assert.equal(h.window[key], undefined);
  }
  h.window.isTauri = false;
  assert.throws(() => h.evaluate(installNativeDialogGateway, [save]), /real Tauri runtime/);
  h.window.isTauri = true;
  h.evaluate(installNativeDialogGateway, [save]);
  const installed = h.window.fetch;
  assert.throws(() => h.evaluate(installNativeDialogGateway, [save]), /already installed/);
  assert.equal(h.window.fetch, installed);
});

test("expiry and manual cleanup restore ownership without overwriting another fetch wrapper", (t) => {
  const h = harness(t);
  h.evaluate(installNativeDialogGateway, [save]);
  const [timer] = h.timers.values();
  assert.equal(timer.timeout, 120_000);
  timer.callback();
  assert.equal(h.window.fetch, h.originalFetch);
  assert.equal(h.window[key], undefined);
  h.evaluate(installNativeDialogGateway, [save]);
  const laterWrapper = () => Promise.resolve(new Response("other"));
  h.window.fetch = laterWrapper;
  const result = h.evaluate(restoreNativeDialogGateway);
  assert.equal(result.restored, false);
  assert.equal(result.originalFetchCurrent, false);
  assert.equal(h.window.fetch, laterWrapper);
  assert.equal(h.window[key], undefined);
});

test("CLI workflow requires a forwarded read-only probe and restores after successful selection", async (t) => {
  const h = harness(t);
  const code = createNativeDialogRunCode(
    [save],
    `async page => {
    const path = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:dialog|save', { options: { title: 'Save export as' } }));
    if (path !== ${JSON.stringify(ownedPath)}) throw new Error('Unexpected fixture path');
    return 'workflow-complete';
  }`,
  );
  const workflow = runInNewContext(`(${code})`, h.context);
  const outcome = await workflow(h.page);
  assert.equal(outcome.result, "workflow-complete");
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].args[0], convertFileSrc("plugin:tracepilot|get_install_type", "ipc"));
  assert.equal(h.window.fetch, h.originalFetch);
  const summary = outcome.gateway;
  assert.equal(summary.nativeProbeForwarded, 1);
  assert.equal(summary.consumed, 1);
  assert.equal(summary.pending, 0);
  assert.equal(summary.restored, true);
  assert.equal(summary.active, false);
  assert.equal(summary.originalFetchCurrent, true);
  assert(!JSON.stringify(outcome).includes("test-secret"));
  assert(!JSON.stringify(outcome).includes(ownedPath));
});

test("CLI cleanup errors preserve an original workflow exception", async (t) => {
  const h = harness(t);
  const originalFailure = new Error("Original workflow failure");
  const page = {
    workflowFailure: originalFailure,
    evaluate(fn, argument) {
      const value = h.evaluate(fn, argument);
      if (fn.name === "restoreNativeDialogGateway") throw new Error("Cleanup transport failure");
      return value;
    },
  };
  const code = createNativeDialogRunCode([save], "async page => { throw page.workflowFailure; }");
  const workflow = runInNewContext(`(${code})`, h.context);
  await assert.rejects(workflow(page), (error) => error === originalFailure);
  assert.equal(h.window.fetch, h.originalFetch);
});

test("CLI cleanup failure after a successful workflow is reported instead of claiming restoration", async (t) => {
  const h = harness(t);
  const cleanupFailure = new Error("Cleanup transport failure");
  const page = {
    evaluate(fn, argument) {
      const value = h.evaluate(fn, argument);
      if (fn.name === "restoreNativeDialogGateway") throw cleanupFailure;
      return value;
    },
  };
  const code = createNativeDialogRunCode(
    [save],
    `async page => {
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:dialog|save', { options: { title: 'Save export as' } }));
    return 'complete';
  }`,
  );
  const workflow = runInNewContext(`(${code})`, h.context);
  await assert.rejects(workflow(page), (error) => error === cleanupFailure);
  assert.equal(h.window.fetch, h.originalFetch);
});

test("CLI workflow restores after failure, incomplete queue, blocked request or unavailable fetch transport", async (t) => {
  for (const scenario of ["failure", "incomplete", "blocked", "fallback", "probe-error"]) {
    await t.test(scenario, async (st) => {
      const h = harness(st, {
        fallbackTransport: scenario === "fallback",
        fetchFailure: scenario === "probe-error",
      });
      let body = "async () => {}";
      if (scenario === "failure") body = "async () => { throw new Error('Workflow failed'); }";
      if (scenario === "blocked") {
        body =
          "async page => { await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:dialog|save', { options: { title: 'Wrong' } })); }";
      }
      const workflow = runInNewContext(`(${createNativeDialogRunCode([save], body)})`, h.context);
      await assert.rejects(workflow(h.page));
      assert.equal(h.window.fetch, h.originalFetch);
      assert.equal(h.window[key], undefined);
      assert.equal(h.timers.size, 0);
    });
  }
});
