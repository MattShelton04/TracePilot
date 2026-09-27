import assert from "node:assert/strict";
import test from "node:test";
import { visualInvoke } from "./fixtures.mjs";

test("config mutations cross the visual fixture boundary as native IPC data", async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const config = new Proxy({ ui: { theme: "dark" } }, {});
  const patch = new Proxy({ ui: { theme: "light" } }, {});
  assert.throws(() => structuredClone(config), { name: "DataCloneError" });
  const received = [];
  const fallback = async (command, args) => {
    received.push([command, args]);
    structuredClone(args.config ?? args.patch);
    return command === "save_config" ? undefined : { ui: { theme: "light" } };
  };

  assert.equal(await visualInvoke("save_config", { config }, fallback), undefined);
  assert.deepEqual(await visualInvoke("update_config", { patch }, fallback), {
    ui: { theme: "light" },
  });
  assert.deepEqual(received, [
    ["save_config", { config: { ui: { theme: "dark" } } }],
    ["update_config", { patch: { ui: { theme: "light" } } }],
  ]);
  assert.deepEqual(globalThis.window.__TRACEPILOT_VISUAL__.missing, []);
});
