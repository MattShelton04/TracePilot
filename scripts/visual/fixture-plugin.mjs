import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const normalized = (path) => path.replaceAll("\\", "/");
/** Keep module IDs in the target checkout so non-fixture imports stay historical. */
export function fixtureModule(source, importer, targetClient) {
  if (!source.startsWith(".") && !source.startsWith("/") && !/^[A-Z]:[\\/]/i.test(source))
    return null;
  const path = normalized(source.startsWith(".") ? resolve(dirname(importer), source) : source);
  const root = `${normalized(targetClient)}/`;
  if (!path.startsWith(root)) return null;
  let relative = path.slice(root.length);
  if (relative === "mock" || relative === "mock/") relative = "mock/index.ts";
  if (!/^(mock\/[\w/-]+|internal\/mockData)(\.(?:js|ts))?$/.test(relative)) return null;
  relative = /\.(js|ts)$/.test(relative) ? relative.replace(/\.js$/, ".ts") : `${relative}.ts`;
  return { id: `${root}${relative}`, relative };
}

export function fixtureCorpusPlugin({ targetRoot, harnessRoot }) {
  const targetClient = resolve(targetRoot, "packages/client/src");
  return {
    name: "visual-shared-fixture-corpus",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return;
      return fixtureModule(source, importer, targetClient)?.id;
    },
    async load(id) {
      const module = fixtureModule(id, id, targetClient);
      if (module)
        return readFile(resolve(harnessRoot, "packages/client/src", module.relative), "utf8");
    },
  };
}
