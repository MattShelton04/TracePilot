import type { SessionFileSearchMatch, SessionFileType } from "@tracepilot/types";
import { ref } from "vue";
import type { SessionFilesState } from "./useSessionFiles";

type ExplorerFiles = Pick<
  SessionFilesState,
  "files" | "selectedPath" | "fileContent" | "fileCanLoadMore" | "selectFile" | "loadFullFile"
>;

/**
 * Opens Explorer files from the tree or from a content-search match, and aims
 * the viewer at a match's line. Only the latest open may aim the viewer or
 * load a file in full: an earlier click whose read finishes last does nothing.
 */
export function useExplorerFileOpener(sessionFiles: ExplorerFiles, getQuery: () => string) {
  const viewerSearchRequest = ref({ id: 0, query: "", line: 0 });
  let openSequence = 0;

  /** True when this open is still the latest and its file is still the one shown. */
  function isCurrent(sequence: number, path: string): boolean {
    return sequence === openSequence && sessionFiles.selectedPath === path;
  }

  async function openFile(path: string): Promise<number> {
    const sequence = ++openSequence;
    const entry = sessionFiles.files.find((f) => f.path === path);
    const fileType: SessionFileType = entry?.fileType ?? "text";
    await sessionFiles.selectFile(path, fileType);
    return sequence;
  }

  async function onViewFile(path: string) {
    await openFile(path);
  }

  async function onContentSearchMatch(match: SessionFileSearchMatch) {
    const sequence = await openFile(match.path);
    if (!isCurrent(sequence, match.path)) return;
    const loadedLines = sessionFiles.fileContent?.split("\n").length ?? 0;
    if (sessionFiles.fileCanLoadMore && match.lineNumber > loadedLines) {
      await sessionFiles.loadFullFile();
      if (!isCurrent(sequence, match.path)) return;
    }
    viewerSearchRequest.value = {
      id: viewerSearchRequest.value.id + 1,
      query: getQuery().trim(),
      line: match.lineNumber,
    };
  }

  return { viewerSearchRequest, onViewFile, onContentSearchMatch };
}
