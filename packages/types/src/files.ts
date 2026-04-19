/** Shared file-entry shape used by both skill assets and session file browsing. */
export interface FileEntry {
  path: string;
  name: string;
  sizeBytes: number;
  isDirectory: boolean;
}
