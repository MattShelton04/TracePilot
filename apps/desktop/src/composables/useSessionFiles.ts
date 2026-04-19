import type { SessionDbTable, SessionFileEntry, SessionFileType } from "@tracepilot/types";
import { sessionListFiles, sessionReadFile, sessionReadSqlite } from "@tracepilot/client";
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
  dbData: SessionDbTable[] | null;
  dbDataLoading: boolean;
  dbDataError: string | null;
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

  const dbData = ref<SessionDbTable[] | null>(null);
  const dbDataLoading = ref(false);
  const dbDataError = ref<string | null>(null);

  // Monotonic counters used to discard results from superseded requests.
  let readSeq = 0;
  let loadSeq = 0;

  async function loadFiles() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    const seq = ++loadSeq;
    filesLoading.value = true;
    filesError.value = null;

    try {
      const result = await sessionListFiles(sessionId);
      // Discard if session changed while we were awaiting
      if (seq !== loadSeq) return;

      files.value = result;

      // Auto-open workspace.yaml if nothing is selected yet
      if (!selectedPath.value) {
        const workspace = files.value.find(
          (f) => !f.isDirectory && (f.name === "workspace.yaml" || f.name === "workspace.yml"),
        );
        if (workspace) {
          await selectFile(workspace.path, workspace.fileType);
        }
      }
    } catch (err) {
      if (seq !== loadSeq) return;
      filesError.value = err instanceof Error ? err.message : String(err);
      files.value = [];
    } finally {
      if (seq === loadSeq) filesLoading.value = false;
    }
  }

  async function selectFile(path: string, fileType: SessionFileType) {
    const sessionId = getSessionId();
    if (!sessionId) return;

    selectedPath.value = path;
    selectedFileType.value = fileType;
    fileContent.value = null;
    fileContentError.value = null;
    dbData.value = null;
    dbDataError.value = null;

    if (fileType === "binary") {
      fileContentLoading.value = false;
      return;
    }

    if (fileType === "sqlite") {
      dbDataLoading.value = true;
      const seq = ++readSeq;
      try {
        const result = await sessionReadSqlite(sessionId, path);
        if (seq !== readSeq) return;
        dbData.value = result;
      } catch (err) {
        if (seq !== readSeq) return;
        dbDataError.value = err instanceof Error ? err.message : String(err);
        dbData.value = null;
      } finally {
        if (seq === readSeq) dbDataLoading.value = false;
      }
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
      dbData.value = null;
      dbDataError.value = null;
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
    get dbData() {
      return dbData.value;
    },
    get dbDataLoading() {
      return dbDataLoading.value;
    },
    get dbDataError() {
      return dbDataError.value;
    },
    selectFile,
    reload: loadFiles,
  };
}
