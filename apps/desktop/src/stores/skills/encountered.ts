import { getSessionTurns, listSessions } from "@tracepilot/client";
import type { ConversationTurn, SkillInvocationEvent, SkillSummary } from "@tracepilot/types";
import { logWarn } from "@/utils/logger";

const RECENT_SESSION_LIMIT = 100;
const SESSION_SCAN_CONCURRENCY = 4;
const GLOBAL_COPILOT_SKILLS_RE = /(?:^|\/)(?:users|home)\/[^/]+\/\.copilot\/skills\//i;

export interface EncounteredSkillSummary extends SkillSummary {
  source: "session";
  invocationCount: number;
  sourcePath?: string;
}

interface EncounteredAccumulator {
  name: string;
  description: string;
  sourcePath?: string;
  estimatedTokens: number;
  invocationCount: number;
}

export type DisplaySkillSummary = SkillSummary | EncounteredSkillSummary;

export function isEncounteredSkill(skill: DisplaySkillSummary): skill is EncounteredSkillSummary {
  return "source" in skill && skill.source === "session";
}

export async function discoverEncounteredProjectSkills(
  installedSkills: readonly SkillSummary[],
): Promise<EncounteredSkillSummary[]> {
  const installedNames = new Set(installedSkills.map((skill) => normalizeSkillName(skill.name)));
  const sessions = await listSessions({ limit: RECENT_SESSION_LIMIT, hideEmpty: true });
  const candidates = sessions.filter((session) => (session.turnCount ?? 0) > 0);
  const failures: Array<{ sessionId: string; error: unknown }> = [];
  const discovered = new Map<string, EncounteredAccumulator>();

  await mapLimit(candidates, SESSION_SCAN_CONCURRENCY, async (session) => {
    try {
      const response = await getSessionTurns(session.id);
      for (const invocation of collectSkillInvocations(response.turns)) {
        const name = invocation.name?.trim();
        if (!name || !isProjectScopedSkillPath(invocation.path)) continue;

        const normalizedName = normalizeSkillName(name);
        if (installedNames.has(normalizedName)) continue;

        const previous = discovered.get(normalizedName);
        const description = normalizeDescription(invocation.description);
        const sourcePath = chooseSourcePath(previous?.sourcePath, invocation.path);
        const estimatedTokens = Math.max(
          previous?.estimatedTokens ?? 0,
          estimateTokens(invocation.contentLength),
        );
        discovered.set(normalizedName, {
          name: chooseDisplayName(previous?.name, name),
          description: chooseDescription(previous?.description, description),
          sourcePath,
          estimatedTokens,
          invocationCount: (previous?.invocationCount ?? 0) + 1,
        });
      }
    } catch (error) {
      failures.push({ sessionId: session.id, error });
    }
  });

  if (failures.length > 0) {
    logWarn("[skills] Some sessions could not be scanned for encountered skills", {
      failedSessions: failures.length,
      scannedSessions: candidates.length,
    });
  }

  return [...discovered.values()]
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      scope: "repository" as const,
      directory: `encountered:${normalizeSkillName(skill.name)}`,
      estimatedTokens: skill.estimatedTokens,
      enabled: true,
      hasAssets: false,
      assetCount: 0,
      source: "session" as const,
      invocationCount: skill.invocationCount,
      sourcePath: skill.sourcePath,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function collectSkillInvocations(turns: readonly ConversationTurn[]): SkillInvocationEvent[] {
  const invocations: SkillInvocationEvent[] = [];
  for (const turn of turns) {
    for (const event of turn.sessionEvents ?? []) {
      if (event.skillInvocation) invocations.push(event.skillInvocation);
    }
    for (const tool of turn.toolCalls ?? []) {
      if (tool.skillInvocation) invocations.push(tool.skillInvocation);
    }
  }
  return invocations;
}

function isProjectScopedSkillPath(path: string | undefined): boolean {
  if (!path) return false;
  const normalized = normalizePath(path);
  if (normalized.includes("/.github/skills/")) return true;
  if (!normalized.includes("/.copilot/skills/")) return false;
  return !GLOBAL_COPILOT_SKILLS_RE.test(normalized);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase();
}

function chooseDisplayName(previous: string | undefined, next: string): string {
  if (!previous) return next;
  return previous.localeCompare(next) <= 0 ? previous : next;
}

function chooseDescription(previous: string | undefined, next: string): string {
  if (!previous) return next;
  if (previous.length !== next.length) return previous.length > next.length ? previous : next;
  return previous.localeCompare(next) <= 0 ? previous : next;
}

function chooseSourcePath(
  previous: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!previous) return next;
  if (!next) return previous;
  return normalizePath(previous).localeCompare(normalizePath(next)) <= 0 ? previous : next;
}

function normalizeDescription(description: string | undefined): string {
  return description?.trim() || "Encountered in recent CLI sessions";
}

function estimateTokens(contentLength: number | undefined): number {
  if (!contentLength || contentLength < 1) return 0;
  return Math.ceil(contentLength / 4);
}

async function mapLimit<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
}
