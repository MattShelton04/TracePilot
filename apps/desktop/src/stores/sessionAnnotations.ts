import {
  IPC_EVENTS,
  listSessionAnnotations,
  type SessionAnnotation,
  type SessionAnnotationPatch,
  updateSessionAnnotation,
} from "@tracepilot/client";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { useScopedEventListener } from "@/composables/useScopedEventListener";
import { toFriendlyErrorMessage } from "@/utils/backendErrors";
import { logWarn } from "@/utils/logger";
import { useToastStore } from "./toast";

/**
 * Stars, archive flags, tags and notes the user records on sessions.
 *
 * Kept in TracePilot's own store (never in session files). Archiving only
 * hides a session in the list. Every window loads the same annotations and
 * applies changes from the others through `SESSION_ANNOTATION_CHANGED`.
 */
export const useSessionAnnotationsStore = defineStore("sessionAnnotations", () => {
  // shallowRef: the map is replaced on every change so computed readers update.
  const byId = shallowRef<ReadonlyMap<string, SessionAnnotation>>(new Map());
  const loaded = ref(false);
  let loading: Promise<void> | null = null;

  function store(annotation: SessionAnnotation) {
    const next = new Map(byId.value);
    if (isEmpty(annotation)) next.delete(annotation.sessionId);
    else next.set(annotation.sessionId, annotation);
    byId.value = next;
  }

  /** Load once; later calls reuse the first load unless `force` is set. */
  function load(options: { force?: boolean } = {}): Promise<void> {
    if (loaded.value && !options.force) return Promise.resolve();
    if (loading) return loading;
    loading = listSessionAnnotations()
      .then((rows) => {
        byId.value = new Map(rows.map((row) => [row.sessionId, row]));
        loaded.value = true;
      })
      .catch((e) => {
        // The list still works without annotations; nothing is starred or hidden.
        logWarn("[sessionAnnotations] Failed to load annotations:", e);
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  function get(sessionId: string): SessionAnnotation | undefined {
    return byId.value.get(sessionId);
  }

  const isStarred = (sessionId: string) => byId.value.get(sessionId)?.starred === true;
  const isArchived = (sessionId: string) => byId.value.get(sessionId)?.archived === true;
  const tagsOf = (sessionId: string): readonly string[] => byId.value.get(sessionId)?.tags ?? [];

  /** Every tag in use, sorted case-insensitively, with how many sessions carry it. */
  const allTags = computed(() => {
    const counts = new Map<string, { tag: string; count: number }>();
    for (const annotation of byId.value.values()) {
      for (const tag of annotation.tags) {
        const key = tag.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { tag, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) =>
      a.tag.toLowerCase().localeCompare(b.tag.toLowerCase()),
    );
  });

  /**
   * Change part of a session's annotation. The change shows at once and is
   * rolled back, with a toast, if saving fails.
   */
  async function update(
    sessionId: string,
    patch: Partial<SessionAnnotationPatch>,
  ): Promise<SessionAnnotation | null> {
    const previous = byId.value.get(sessionId);
    store(optimistic(sessionId, previous, patch));
    try {
      const saved = await updateSessionAnnotation(sessionId, patch);
      store(saved);
      return saved;
    } catch (e) {
      const restore = new Map(byId.value);
      if (previous) restore.set(sessionId, previous);
      else restore.delete(sessionId);
      byId.value = restore;
      useToastStore().error(
        `Couldn't save that change: ${toFriendlyErrorMessage(e) ?? "unknown error"}`,
      );
      return null;
    }
  }

  const toggleStar = (sessionId: string) => update(sessionId, { starred: !isStarred(sessionId) });
  const setArchived = (sessionId: string, archived: boolean) => update(sessionId, { archived });
  const setTags = (sessionId: string, tags: string[]) => update(sessionId, { tags });
  const setNote = (sessionId: string, note: string) => update(sessionId, { note });

  /** Apply changes saved by another window. */
  const watchChanges = useScopedEventListener<SessionAnnotation>(
    IPC_EVENTS.SESSION_ANNOTATION_CHANGED,
    (event) => store(event.payload),
  );

  return {
    byId,
    loaded,
    load,
    get,
    isStarred,
    isArchived,
    tagsOf,
    allTags,
    update,
    toggleStar,
    setArchived,
    setTags,
    setNote,
    watchChanges,
  };
});

function isEmpty(a: SessionAnnotation): boolean {
  return !a.starred && !a.archived && a.tags.length === 0 && !a.note;
}

function optimistic(
  sessionId: string,
  previous: SessionAnnotation | undefined,
  patch: Partial<SessionAnnotationPatch>,
): SessionAnnotation {
  const next: SessionAnnotation = previous
    ? { ...previous }
    : { sessionId, starred: false, archived: false, tags: [], note: null, updatedAt: null };
  if (patch.starred != null) next.starred = patch.starred;
  if (patch.archived != null) next.archived = patch.archived;
  if (patch.tags != null) next.tags = [...patch.tags];
  if (patch.note != null) next.note = patch.note.trim() || null;
  return next;
}
