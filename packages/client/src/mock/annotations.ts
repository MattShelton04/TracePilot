import type { SessionAnnotation, SessionAnnotationPatch } from "../generated/bindings.js";
import { NOW_MS } from "./common.js";

/** Seeded so the mock UI shows a starred, tagged and noted session. */
const SEEDED: SessionAnnotation[] = [
  {
    sessionId: "sess-auth-refactor",
    starred: true,
    archived: false,
    tags: ["auth", "needs review"],
    note: "Token refresh retries look right; check the 429 handling in turn 3.",
    updatedAt: new Date(NOW_MS).toISOString(),
  },
];

let annotations = new Map(SEEDED.map((a) => [a.sessionId, { ...a, tags: [...a.tags] }]));

/** Restore the seeded annotations (tests). */
export function resetMockAnnotations(): void {
  annotations = new Map(SEEDED.map((a) => [a.sessionId, { ...a, tags: [...a.tags] }]));
}

function applyPatch(sessionId: string, patch: Partial<SessionAnnotationPatch>): SessionAnnotation {
  const current = annotations.get(sessionId) ?? {
    sessionId,
    starred: false,
    archived: false,
    tags: [],
    note: null,
    updatedAt: null,
  };
  const next: SessionAnnotation = { ...current, tags: [...current.tags] };
  if (patch.starred != null) next.starred = patch.starred;
  if (patch.archived != null) next.archived = patch.archived;
  if (patch.tags != null) {
    const seen = new Set<string>();
    next.tags = patch.tags
      .map((t) => t.trim().split(/\s+/).join(" "))
      .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }
  if (patch.note != null) next.note = patch.note.trim() || null;
  const empty = !next.starred && !next.archived && next.tags.length === 0 && !next.note;
  if (empty) {
    annotations.delete(sessionId);
    return { ...next, updatedAt: null };
  }
  next.updatedAt = new Date().toISOString();
  annotations.set(sessionId, next);
  return next;
}

/** Stateful mock for the annotation commands, so the UI can be exercised without Tauri. */
export function annotationsMockRoute(
  cmd: string,
  args?: Record<string, unknown>,
): { value: unknown } | null {
  if (cmd === "list_session_annotations") {
    return { value: [...annotations.values()].map((a) => ({ ...a, tags: [...a.tags] })) };
  }
  if (cmd === "update_session_annotation") {
    const sessionId = String(args?.sessionId ?? "");
    const patch = (args?.patch ?? {}) as Partial<SessionAnnotationPatch>;
    return { value: applyPatch(sessionId, patch) };
  }
  return null;
}
