/**
 * Session annotations: stars, archive flags, tags and notes.
 *
 * Stored in TracePilot's own `annotations.db`; agent session files are never
 * modified. Archiving only hides a session in TracePilot.
 */
import type { SessionAnnotation, SessionAnnotationPatch } from "./generated/bindings.js";
import { invoke } from "./internal/core.js";

/** Every annotated session. Sessions without an annotation are omitted. */
export async function listSessionAnnotations(): Promise<SessionAnnotation[]> {
  return invoke<SessionAnnotation[]>("list_session_annotations");
}

/**
 * Change some of a session's annotation; absent fields keep their value.
 * `tags` replaces the whole set and an empty `note` clears the note.
 */
export async function updateSessionAnnotation(
  sessionId: string,
  patch: Partial<SessionAnnotationPatch>,
): Promise<SessionAnnotation> {
  return invoke<SessionAnnotation>("update_session_annotation", {
    sessionId,
    patch: {
      starred: patch.starred ?? null,
      archived: patch.archived ?? null,
      tags: patch.tags ?? null,
      note: patch.note ?? null,
    },
  });
}
