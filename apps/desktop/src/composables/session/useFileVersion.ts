/**
 * useFileVersion — opens one backed-up file version from a session's file
 * history at a time. Content is read only when the user asks for it, and a
 * response for a version that is no longer open is dropped.
 */
import { type FileVersionContent, getSessionFileVersion } from "@tracepilot/client";
import { toErrorMessage } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { type MaybeRefOrGetter, ref, shallowRef, toValue, watch } from "vue";

export function useFileVersion(sessionId: MaybeRefOrGetter<string | null>) {
  const guard = useAsyncGuard();
  /** `<checkpoint>:<backup>` of the open version, so one row opens at a time. */
  const openKey = ref<string | null>(null);
  const content = shallowRef<FileVersionContent | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function close() {
    guard.invalidate();
    openKey.value = null;
    content.value = null;
    loading.value = false;
    error.value = null;
  }

  async function toggle(key: string, backup: string) {
    const id = toValue(sessionId);
    if (openKey.value === key || !id) {
      close();
      return;
    }
    const token = guard.start();
    openKey.value = key;
    content.value = null;
    error.value = null;
    loading.value = true;
    try {
      const result = await getSessionFileVersion(id, backup);
      if (guard.isValid(token)) content.value = result;
    } catch (e) {
      if (guard.isValid(token)) error.value = toErrorMessage(e);
    } finally {
      if (guard.isValid(token)) loading.value = false;
    }
  }

  watch(() => toValue(sessionId), close);

  return { openKey, content, loading, error, toggle, close };
}
