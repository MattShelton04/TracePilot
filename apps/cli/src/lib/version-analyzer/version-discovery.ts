import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseAgentDefinitions, parseApiSchema, parseSessionEventsSchema } from "./schema.js";
import type { CopilotVersion } from "./types.js";

function getCopilotPkgDir(): string {
  return join(homedir(), ".copilot", "pkg", "universal");
}

function findExistingFile(baseDir: string, candidates: string[]): string | undefined {
  return candidates.map((candidate) => join(baseDir, candidate)).find((path) => existsSync(path));
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export function discoverInstalledVersions(pkgDir = getCopilotPkgDir()): CopilotVersion[] {
  if (!existsSync(pkgDir)) return [];

  const dirs = readdirSync(pkgDir).filter((d) => {
    const full = join(pkgDir, d);
    return statSync(full).isDirectory() && /^\d+\.\d+\.\d+/.test(d);
  });

  return dirs.sort(compareVersions).map((version) => {
    const versionDir = join(pkgDir, version);
    const eventsSchemaPath = findExistingFile(versionDir, [
      join("schemas", "session-events.schema.json"),
      join("schemas", "session_events.schema.json"),
    ]);
    const apiSchemaPath = findExistingFile(versionDir, [
      join("schemas", "api.schema.json"),
      join("schemas", "api-schema.json"),
    ]);

    // Try to get git commit from package.json
    let gitCommit: string | undefined;
    const pkgJsonPath = join(versionDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        gitCommit = pkg.gitHead ?? pkg.gitCommit;
      } catch {
        /* ignore */
      }
    }

    return {
      version,
      gitCommit,
      path: versionDir,
      eventTypes: eventsSchemaPath ? parseSessionEventsSchema(eventsSchemaPath) : [],
      rpcMethods: apiSchemaPath ? parseApiSchema(apiSchemaPath) : [],
      agents: parseAgentDefinitions(versionDir),
    };
  });
}
