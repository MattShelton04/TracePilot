import type { SessionDbTable, SessionImagePreview } from "@tracepilot/types";

interface CachedTextPage {
  content: string;
  full: boolean;
  listedSize: number;
  savedAt: number;
  cost: number;
}

export type CachedSessionAsset =
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

const TEXT_CACHE_MAX_ENTRIES = 8;
const TEXT_CACHE_MAX_BYTES = 8 * 1_024 * 1_024;
const ASSET_CACHE_MAX_ENTRIES = 4;
const ASSET_CACHE_MAX_BYTES = 16 * 1_024 * 1_024;
const CACHE_TTL_MS = 30_000;

export function estimateDbCost(tables: SessionDbTable[]): number {
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

/** Size- and age-bounded LRU cache for session explorer payloads. */
export class SessionFileCache {
  private readonly text = new Map<string, CachedTextPage>();
  private readonly assets = new Map<string, CachedSessionAsset>();
  private textBytes = 0;
  private assetBytes = 0;

  constructor(private readonly listedSizeFor: (path: string) => number | undefined) {}

  clear(): void {
    this.text.clear();
    this.assets.clear();
    this.textBytes = 0;
    this.assetBytes = 0;
  }

  removeText(path: string): void {
    const cached = this.text.get(path);
    if (!cached) return;
    this.textBytes -= cached.cost;
    this.text.delete(path);
  }

  removeAsset(path: string): void {
    const cached = this.assets.get(path);
    if (!cached) return;
    this.assetBytes -= cached.cost;
    this.assets.delete(path);
  }

  putText(path: string, content: string, full: boolean): void {
    const entry: CachedTextPage = {
      content,
      full,
      listedSize: this.listedSizeFor(path) ?? content.length,
      savedAt: Date.now(),
      // JavaScript strings are commonly UTF-16; count two bytes per code unit.
      cost: content.length * 2,
    };
    if (entry.cost > TEXT_CACHE_MAX_BYTES) return;
    this.removeText(path);
    this.text.set(path, entry);
    this.textBytes += entry.cost;
    while (this.text.size > TEXT_CACHE_MAX_ENTRIES || this.textBytes > TEXT_CACHE_MAX_BYTES) {
      const oldest = this.text.keys().next().value as string | undefined;
      if (!oldest) break;
      this.removeText(oldest);
    }
  }

  getText(path: string): CachedTextPage | null {
    const cached = this.text.get(path);
    if (!cached) return null;
    const listedSize = this.listedSizeFor(path);
    if (
      Date.now() - cached.savedAt > CACHE_TTL_MS ||
      (listedSize !== undefined && listedSize !== cached.listedSize)
    ) {
      this.removeText(path);
      return null;
    }
    this.text.delete(path);
    this.text.set(path, cached);
    return cached;
  }

  putAsset(path: string, asset: CachedSessionAsset): void {
    this.removeAsset(path);
    if (asset.cost > ASSET_CACHE_MAX_BYTES) return;
    this.assets.set(path, asset);
    this.assetBytes += asset.cost;
    while (this.assets.size > ASSET_CACHE_MAX_ENTRIES || this.assetBytes > ASSET_CACHE_MAX_BYTES) {
      const oldest = this.assets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.removeAsset(oldest);
    }
  }

  getAsset(path: string, kind: CachedSessionAsset["kind"]): CachedSessionAsset | null {
    const cached = this.assets.get(path);
    if (!cached || cached.kind !== kind) return null;
    const listedSize = this.listedSizeFor(path) ?? cached.listedSize;
    if (Date.now() - cached.savedAt > CACHE_TTL_MS || listedSize !== cached.listedSize) {
      this.removeAsset(path);
      return null;
    }
    this.assets.delete(path);
    this.assets.set(path, cached);
    return cached;
  }
}
