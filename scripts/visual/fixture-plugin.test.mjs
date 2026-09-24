import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fixtureCorpusPlugin, fixtureModule } from "./fixture-plugin.mjs";

test("head fixture imports resolve even when the newly added file is absent from base", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "visual-fixtures-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const targetRoot = join(root, "base"),
    harnessRoot = join(root, "head");
  const client = join(targetRoot, "packages/client/src");
  const corpus = join(harnessRoot, "packages/client/src/mock");
  await mkdir(corpus, { recursive: true });
  await writeFile(join(corpus, "index.ts"), 'export { agents } from "./agentFixtures.js";');
  await writeFile(join(corpus, "agentFixtures.ts"), 'export const agents = ["synthetic"];');
  const plugin = fixtureCorpusPlugin({ targetRoot, harnessRoot });
  const index = plugin.resolveId("./mock", join(client, "agents.ts"));
  assert.match(await plugin.load(index), /agentFixtures/);
  const added = plugin.resolveId("./agentFixtures.js", index);
  assert.equal(await plugin.load(added), 'export const agents = ["synthetic"];');
  await assert.rejects(readFile(added), /ENOENT/);
  // Client adapters, defaults, components and dependencies remain historical.
  for (const source of ["../agents.js", "../invoke.js", "@tracepilot/types", "vue"])
    assert.equal(plugin.resolveId(source, index), undefined);
  assert.equal(fixtureModule(resolve(root, "other/mock/index.ts"), index, client), null);
});
