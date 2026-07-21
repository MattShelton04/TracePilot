import {
  sessionListFiles,
  sessionReadFile,
  sessionReadImagePreview,
  sessionReadSqlite,
} from "@tracepilot/client";
import type {
  SessionDbTable,
  SessionFileEntry,
  SessionFileType,
  SessionImagePreview,
} from "@tracepilot/types";
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
  imagePreview: SessionImagePreview | null;
  imageLoading: boolean;
  imageError: string | null;
  dbData: SessionDbTable[] | null;
  dbDataLoading: boolean;
  dbDataError: string | null;
  /** Newly-seen file paths since the last reload — transient, cleared by `ackNewPaths()`. */
  newFilePaths: Readonly<Set<string>>;
  /**
   * When a file is open in the viewer, tracks whether its content changed on the
   * last silent refresh. Transient; cleared by `ackContentChanged()`.
   */
  contentChangedAt: number | null;
  fileCanLoadMore: boolean;
  selectFile: (path: string, fileType: SessionFileType) => Promise<void>;
  loadFullFile: () => Promise<void>;
  /**
   * Reload files + (if a file is open) refetch its content in place.
   *
   * @param opts.silent When true (default for auto-refresh), skips toggling
   *   `filesLoading`/`fileContentLoading`/`dbDataLoading` so the DOM stays
   *   mounted and scroll position / focus are preserved. The file content
   *   ref is only swapped if the new content differs from the current.
   */
  reload: (opts?: { silent?: boolean }) => Promise<void>;
  /** Acknowledge the new-paths highlight so it fades on the next tick. */
  ackNewPaths: () => void;
  /** Acknowledge the content-changed highlight. */
  ackContentChanged: () => void;
}

/**
 * Manages file listing and content loading for a session's file explorer.
 *
 * @param getSessionId - reactive getter for the current session ID
 */
export function useSessionFiles(getSessionId: () => string | null | undefined): SessionFilesState {
  const files = ref<SessionFileEntry[]>([]);
  const filesLoading = ref(false);
  const filesError = ref<string | null>(null);

  const selectedPath = ref<string | null>(null);
  const selectedFileType = ref<SessionFileType | null>(null);
  const fileContent = ref<string | null>(null);
  const fileContentLoading = ref(false);
  const fileContentError = ref<string | null>(null);

  const imagePreview = ref<SessionImagePreview | null>(null);
  const imageLoading = ref(false);
  const imageError = ref<string | null>(null);

  const dbData = ref<SessionDbTable[] | null>(null);
  const dbDataLoading = ref(false);
  const dbDataError = ref<string | null>(null);

  // New-file highlight bookkeeping: set of paths that appeared on the most
  // recent silent refresh. Cleared by the consumer after it has rendered the
  // highlight (see `ackNewPaths`). This stays empty after the initial load so
  // we don't flash every file green on first mount.
  const newFilePaths = ref<Set<string>>(new Set());
  const contentChangedAt = ref<number | null>(null);
  const fullContentRequested = ref(false);

  interface CachedTextPage {
    content: string;
    full: boolean;
    listedSize: number;
    savedAt: number;
    cost: number;
  }
  const TEXT_CACHE_MAX_ENTRIES = 8;
  const TEXT_CACHE_MAX_BYTES = 8 * 1_024 * 1_024;
  const TEXT_CACHE_TTL_MS = 30_000;
  const textCache = new Map<string, CachedTextPage>();
  let textCacheBytes = 0;

  type CachedAsset =
    | {
        kind: "image";
        value: SessionImagePreview;
        savedAt: number;
        listedSize: number;
        cost: number;
      }
    | {
        kind: "sqlite";
        value: SessionDbTable[];
        savedAt: number;
        listedSize: number;
        cost: number;
      };
  const ASSET_CACHE_MAX_ENTRIES = 4;
  const ASSET_CACHE_MAX_BYTES = 16 * 1_024 * 1_024;
  const assetCache = new Map<string, CachedAsset>();
  let assetCacheBytes = 0;

  function removeCachedAsset(path: string) {
    const cached = assetCache.get(path);
    if (!cached) return;
    assetCacheBytes -= cached.cost;
    assetCache.delete(path);
  }

  function estimateDbCost(tables: SessionDbTable[]) {
    let cost = 0;
    for (const table of tables) {
      cost += table.name.length * 2;
      for (const column of table.columns) cost += column.length * 2;
      for (const row of table.rows) {
        for (const cell of row) cost += typeof cell === "string" ? cell.length * 2 : 8;
      }
    }
    return cost;
  }

  function cacheAsset(path: string, asset: CachedAsset) {
    removeCachedAsset(path);
    if (asset.cost > ASSET_CACHE_MAX_BYTES) return;
    assetCache.set(path, asset);
    assetCacheBytes += asset.cost;
    while (assetCache.size > ASSET_CACHE_MAX_ENTRIES || assetCacheBytes > ASSET_CACHE_MAX_BYTES) {
      const oldest = assetCache.keys().next().value as string | undefined;
      if (!oldest) break;
      removeCachedAsset(oldest);
    }
  }

  function getCachedAsset(path: string, kind: CachedAsset["kind"]) {
    const cached = assetCache.get(path);
    if (!cached || cached.kind !== kind) return null;
    const listedSize =
      files.value.find((file) => file.path === path)?.sizeBytes ?? cached.listedSize;
    if (Date.now() - cached.savedAt > TEXT_CACHE_TTL_MS || listedSize !== cached.listedSize) {
      removeCachedAsset(path);
      return null;
    }
    assetCache.delete(path);
    assetCache.set(path, cached);
    return cached;
  }

  function removeCachedText(path: string) {
    const cached = textCache.get(path);
    if (!cached) return;
    textCacheBytes -= cached.cost;
    textCache.delete(path);
  }

  function cacheTextPage(path: string, content: string, full: boolean) {
    const entry: CachedTextPage = {
      content,
      full,
      listedSize: files.value.find((file) => file.path === path)?.sizeBytes ?? content.length,
      savedAt: Date.now(),
      // JavaScript strings are commonly UTF-16; count two bytes per code unit.
      cost: content.length * 2,
    };
    if (entry.cost > TEXT_CACHE_MAX_BYTES) return;
    removeCachedText(path);
    textCache.set(path, entry);
    textCacheBytes += entry.cost;
    while (textCache.size > TEXT_CACHE_MAX_ENTRIES || textCacheBytes > TEXT_CACHE_MAX_BYTES) {
      const oldest = textCache.keys().next().value as string | undefined;
      if (!oldest) break;
      removeCachedText(oldest);
    }
  }

  function getCachedText(path: string): CachedTextPage | null {
    const cached = textCache.get(path);
    if (!cached) return null;
    const listedSize = files.value.find((file) => file.path === path)?.sizeBytes;
    if (
      Date.now() - cached.savedAt > TEXT_CACHE_TTL_MS ||
      (listedSize !== undefined && listedSize !== cached.listedSize)
    ) {
      removeCachedText(path);
      return null;
    }
    textCache.delete(path);
    textCache.set(path, cached);
    return cached;
  }
  let knownPaths: Set<string> = new Set();
  // Track size-per-path so a size change (the common signal for "agent wrote
  // to this file") can flash the entry even when it isn't the selected file.
  // Imperfect vs mtime — a same-size rewrite won't flag — but catches the
  // dominant append/save case without requiring a Rust-side schema change.
  let knownSizes: Map<string, number> = new Map();
  let hasInitialLoad = false;

  // Monotonic counters used to discard results from superseded requests.
  // `readSeq` tracks user-initiated selectFile() calls (which own the loading
  // flags). `silentSeq` tracks background silentRefetchSelected() calls; kept
  // separate so a silent refetch started mid-selectFile() cannot preempt the
  // user call's sequence guard and leave loading flags stuck `true`.
  let readSeq = 0;
  let silentSeq = 0;
  let loadSeq = 0;

  async function loadFiles(opts: { silent?: boolean } = {}) {
    const sessionId = getSessionId();
    if (!sessionId) return;

    const silent = opts.silent ?? false;
    const seq = ++loadSeq;
    // Silent refresh keeps the existing list mounted so scroll/focus survive.
    if (!silent) filesLoading.value = true;
    filesError.value = null;

    try {
      const result = await sessionListFiles(sessionId);
      // Discard if session changed while we were awaiting
      if (seq !== loadSeq) return;

      // Detect newly-appeared paths and size-changed paths for the bonus
      // highlight. Skip on the very first load so every file isn't flagged.
      if (hasInitialLoad) {
        const nextNew = new Set<string>();
        for (const entry of result) {
          if (entry.isDirectory) continue;
          if (!knownPaths.has(entry.path)) {
            nextNew.add(entry.path);
          } else {
            const prevSize = knownSizes.get(entry.path);
            if (prevSize !== undefined && prevSize !== entry.sizeBytes) {
              nextNew.add(entry.path);
              removeCachedText(entry.path);
              removeCachedAsset(entry.path);
            }
          }
        }
        if (nextNew.size > 0) newFilePaths.value = nextNew;
      }
      knownPaths = new Set(result.filter((e) => !e.isDirectory).map((e) => e.path));
      knownSizes = new Map(result.filter((e) => !e.isDirectory).map((e) => [e.path, e.sizeBytes]));
      hasInitialLoad = true;

      files.value = result;

      // Auto-open workspace.yaml if nothing is selected yet
      if (!selectedPath.value) {
        const workspace = files.value.find(
          (f) => !f.isDirectory && (f.name === "workspace.yaml" || f.name === "workspace.yml"),
        );
        if (workspace) {
          await selectFile(workspace.path, workspace.fileType);
        }
      } else if (silent) {
        // Refetch the open file silently so agent-driven edits on disk show
        // up without the user having to re-click the file.
        const open = files.value.find((f) => f.path === selectedPath.value);
        if (open && !open.isDirectory) {
          void silentRefetchSelected(open.fileType);
        }
      }
    } catch (err) {
      if (seq !== loadSeq) return;
      filesError.value = err instanceof Error ? err.message : String(err);
      if (!silent) files.value = [];
    } finally {
      if (seq === loadSeq && !silent) filesLoading.value = false;
    }
  }

  /**
   * Re-read the currently-open file's content / SQLite tables in place.
   * Does NOT toggle loading flags and only mutates the ref when content
   * actually differs, so the viewer DOM stays stable and scroll is preserved.
   */
  async function silentRefetchSelected(fileType: SessionFileType) {
    const sessionId = getSessionId();
    const path = selectedPath.value;
    if (!sessionId || !path) return;
    if (fileType === "binary") return;

    const seq = ++silentSeq;
    try {
      if (fileType === "sqlite") {
        const result = await sessionReadSqlite(sessionId, path);
        if (seq !== silentSeq || selectedPath.value !== path) return;
        // Replace wholesale — SqliteViewer reacts to the prop change.
        dbData.value = result;
        cacheAsset(path, {
          kind: "sqlite",
          value: result,
          savedAt: Date.now(),
          listedSize: files.value.find((file) => file.path === path)?.sizeBytes ?? 0,
          cost: estimateDbCost(result),
        });
        dbDataError.value = null;
        return;
      }
      if (fileType === "image") {
        const result = await sessionReadImagePreview(sessionId, path);
        if (seq !== silentSeq || selectedPath.value !== path) return;
        if (result.base64Data !== imagePreview.value?.base64Data) {
          imagePreview.value = result;
          cacheAsset(path, {
            kind: "image",
            value: result,
            savedAt: Date.now(),
            listedSize: files.value.find((file) => file.path === path)?.sizeBytes ?? 0,
            cost: result.base64Data.length * 2,
          });
          contentChangedAt.value = Date.now();
        }
        imageError.value = null;
        return;
      }
      const result = fullContentRequested.value
        ? await sessionReadFile(sessionId, path, true)
        : await sessionReadFile(sessionId, path);
      if (seq !== silentSeq || selectedPath.value !== path) return;
      if (result !== fileContent.value) {
        fileContent.value = result;
        contentChangedAt.value = Date.now();
      }
      cacheTextPage(path, result, fullContentRequested.value);
      fileContentError.value = null;
    } catch (err) {
      if (seq !== silentSeq || selectedPath.value !== path) return;
      // Silent refresh failures should not clobber existing content — only
      // surface the error so the user sees a hint but keeps the stale view.
      if (fileType === "sqlite") {
        dbDataError.value = err instanceof Error ? err.message : String(err);
      } else if (fileType === "image") {
        imageError.value = err instanceof Error ? err.message : String(err);
      } else {
        fileContentError.value = err instanceof Error ? err.message : String(err);
      }
    }
  }

  async function selectFile(path: string, fileType: SessionFileType) {
    const sessionId = getSessionId();
    if (!sessionId) return;

    selectedPath.value = path;
    selectedFileType.value = fileType;
    fileContent.value = null;
    fileContentError.value = null;
    fileContentLoading.value = false;
    imagePreview.value = null;
    imageError.value = null;
    imageLoading.value = false;
    dbData.value = null;
    dbDataError.value = null;
    dbDataLoading.value = false;
    fullContentRequested.value = false;
    const seq = ++readSeq;

    if (fileType === "binary") {
      fileContentLoading.value = false;
      return;
    }

    if (fileType === "image") {
      const cached = getCachedAsset(path, "image");
      if (cached?.kind === "image") {
        imagePreview.value = cached.value;
        return;
      }
      imageLoading.value = true;
      try {
        const result = await sessionReadImagePreview(sessionId, path);
        if (seq !== readSeq) return;
        imagePreview.value = result;
        cacheAsset(path, {
          kind: "image",
          value: result,
          savedAt: Date.now(),
          listedSize: files.value.find((file) => file.path === path)?.sizeBytes ?? 0,
          cost: result.base64Data.length * 2,
        });
      } catch (err) {
        if (seq !== readSeq) return;
        imageError.value = err instanceof Error ? err.message : String(err);
        imagePreview.value = null;
      } finally {
        if (seq === readSeq) imageLoading.value = false;
      }
      return;
    }

    if (fileType === "sqlite") {
      const cached = getCachedAsset(path, "sqlite");
      if (cached?.kind === "sqlite") {
        dbData.value = cached.value;
        return;
      }
      dbDataLoading.value = true;
      try {
        const result = await sessionReadSqlite(sessionId, path);
        if (seq !== readSeq) return;
        dbData.value = result;
        cacheAsset(path, {
          kind: "sqlite",
          value: result,
          savedAt: Date.now(),
          listedSize: files.value.find((file) => file.path === path)?.sizeBytes ?? 0,
          cost: estimateDbCost(result),
        });
      } catch (err) {
        if (seq !== readSeq) return;
        dbDataError.value = err instanceof Error ? err.message : String(err);
        dbData.value = null;
      } finally {
        if (seq === readSeq) dbDataLoading.value = false;
      }
      return;
    }

    const cached = getCachedText(path);
    if (cached) {
      fileContent.value = cached.content;
      fullContentRequested.value = cached.full;
      return;
    }

    fileContentLoading.value = true;

    try {
      const result = await sessionReadFile(sessionId, path);
      // Discard if a newer request has since been started
      if (seq !== readSeq) return;
      fileContent.value = result;
      cacheTextPage(path, result, false);
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

  async function loadFullFile() {
    const sessionId = getSessionId();
    const path = selectedPath.value;
    const fileType = selectedFileType.value;
    if (
      !sessionId ||
      !path ||
      !fileType ||
      fileType === "binary" ||
      fileType === "image" ||
      fileType === "sqlite"
    ) {
      return;
    }

    fileContentLoading.value = true;
    fileContentError.value = null;
    const seq = ++readSeq;
    try {
      const result = await sessionReadFile(sessionId, path, true);
      if (seq !== readSeq || selectedPath.value !== path) return;
      fileContent.value = result;
      fullContentRequested.value = true;
      cacheTextPage(path, result, true);
    } catch (err) {
      if (seq !== readSeq || selectedPath.value !== path) return;
      fileContentError.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (seq === readSeq) fileContentLoading.value = false;
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
      fileContentLoading.value = false;
      imagePreview.value = null;
      imageError.value = null;
      imageLoading.value = false;
      dbData.value = null;
      dbDataError.value = null;
      dbDataLoading.value = false;
      fullContentRequested.value = false;
      textCache.clear();
      textCacheBytes = 0;
      assetCache.clear();
      assetCacheBytes = 0;
      knownPaths = new Set();
      knownSizes = new Map();
      newFilePaths.value = new Set();
      contentChangedAt.value = null;
      hasInitialLoad = false;
      if (id) void loadFiles();
    },
    { immediate: true },
  );

  function ackNewPaths() {
    if (newFilePaths.value.size > 0) newFilePaths.value = new Set();
  }

  function ackContentChanged() {
    contentChangedAt.value = null;
  }

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
    get imagePreview() {
      return imagePreview.value;
    },
    get imageLoading() {
      return imageLoading.value;
    },
    get imageError() {
      return imageError.value;
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
    get newFilePaths() {
      return newFilePaths.value;
    },
    get contentChangedAt() {
      return contentChangedAt.value;
    },
    get fileCanLoadMore() {
      if (fullContentRequested.value || !selectedPath.value) return false;
      const entry = files.value.find((file) => file.path === selectedPath.value);
      return (entry?.sizeBytes ?? 0) > 1_024 * 1_024;
    },
    selectFile,
    loadFullFile,
    reload: (opts) => loadFiles({ silent: true, ...(opts ?? {}) }),
    ackNewPaths,
    ackContentChanged,
  };
}
