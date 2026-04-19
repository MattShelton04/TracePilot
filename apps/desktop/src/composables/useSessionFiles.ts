import type { SessionFileEntry, SessionFileType } from "@tracepilot/types";
import { sessionListFiles, sessionReadFile } from "@tracepilot/client";
import { ref, watch } from "vue";

export interface SessionFilesState {
  files: Readonly<SessionFileEntry[]>;
  filesLoading: boolean;
  filesError: string | null;
  selectedPath: string | null;
  selectedFileType: SessionFileType | null;
  fileContent: string | null;
  fileContentLoading: boolean;
  fileContentError: string | null;
  selectFile: (path: string, fileType: SessionFileType) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Manages file listing and content loading for a session's file explorer.
 *
 * @param getSessionId - reactive getter for the current session ID
 */
export function useSessionFiles(
  getSessionId: () => string | null | undefined,
): SessionFilesState {
  const files = ref<SessionFileEntry[]>([]);
  const filesLoading = ref(false);
  const filesError = ref<string | null>(null);

  const selectedPath = ref<string | null>(null);
  const selectedFileType = ref<SessionFileType | null>(null);
  const fileContent = ref<string | null>(null);
  const fileContentLoading = ref(false);
  const fileContentError = ref<string | null>(null);

  // Monotonic counter used to discard results from superseded requests.
  let readSeq = 0;

  async function loadFiles() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    filesLoading.value = true;
    filesError.value = null;

    try {
      files.value = await sessionListFiles(sessionId);
    } catch (err) {
      filesError.value = err instanceof Error ? err.message : String(err);
      files.value = [];
    } finally {
      filesLoading.value = false;
    }
  }

  async function selectFile(path: string, fileType: SessionFileType) {
    const sessionId = getSessionId();
    if (!sessionId) return;

    selectedPath.value = path;
    selectedFileType.value = fileType;
    fileContent.value = null;
    fileContentError.value = null;

    if (fileType === "sqlite" || fileType === "binary") {
      // No content to load — the viewer will show a placeholder
      fileContentLoading.value = false;
      return;
    }

    fileContentLoading.value = true;
    const seq = ++readSeq;

    try {
      const result = await sessionReadFile(sessionId, path);
      // Discard if a newer request has since been started
      if (seq !== readSeq) return;
      fileContent.value = result;
    } catch (err) {
      if (seq !== readSeq) return;
      fileContentError.value = err instanceof Error ? err.message : String(err);
      fileContent.value = null;
    } finally {
      if (seq === readSeq) {
        fileContentLoading.value = false;
      }
    }
  }

  // Reload when session changes
  watch(
    getSessionId,
    (id) => {
      files.value = [];
      filesError.value = null;
      selectedPath.value = null;
      selectedFileType.value = null;
      fileContent.value = null;
      fileContentError.value = null;
      if (id) void loadFiles();
    },
    { immediate: true },
  );

  return {
    get files() {
      return files.value;
    },
    get filesLoading() {
      return filesLoading.value;
    },
    get filesError() {
      return filesError.value;
    },
    get selectedPath() {
      return selectedPath.value;
    },
    get selectedFileType() {
      return selectedFileType.value;
    },
    get fileContent() {
      return fileContent.value;
    },
    get fileContentLoading() {
      return fileContentLoading.value;
    },
    get fileContentError() {
      return fileContentError.value;
    },
    selectFile,
    reload: loadFiles,
  };
}
