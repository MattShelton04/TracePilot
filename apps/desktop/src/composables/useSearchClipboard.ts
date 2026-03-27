import type { SearchResult } from '@tracepilot/types';

/** Safely extract text from an HTML snippet (handles code like `a < b && c > d`). */
export function stripHtml(html: string): string {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent ?? '';
  } catch {
    // Fallback: only strip known safe tags (<mark>, </mark>)
    return html.replace(/<\/?mark>/gi, '');
  }
}

/**
 * Composable providing clipboard copy helpers for search results.
 *
 * Stateless — takes search results as arguments rather than reading from
 * store state, so it can be used directly in components without coupling
 * to the Pinia search store.
 */
export function useSearchClipboard() {
  /** Copy one or more search results to the clipboard as formatted text. */
  async function copyResultsToClipboard(items: SearchResult[]): Promise<boolean> {
    if (items.length === 0) return false;
    const text = items.map(r => {
      const meta = [r.contentType.replace(/_/g, ' '), r.toolName].filter(Boolean).join(' · ');
      const plainSnippet = stripHtml(r.snippet);
      const header = r.sessionSummary ? `[${r.sessionSummary}] ${meta}` : `[${meta}]`;
      return `${header}\n${plainSnippet}`;
    }).join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { return false; }
  }

  /** Copy a single search result to the clipboard with full metadata. */
  async function copySingleResult(result: SearchResult): Promise<boolean> {
    try {
      const plainSnippet = stripHtml(result.snippet);
      const parts: string[] = [];
      if (result.sessionSummary) parts.push(`Session: ${result.sessionSummary}`);
      const meta = [result.contentType.replace(/_/g, ' ')];
      if (result.toolName) meta.push(`tool: ${result.toolName}`);
      if (result.turnNumber != null) meta.push(`turn ${result.turnNumber}`);
      parts.push(meta.join(' · '));
      parts.push('');
      parts.push(plainSnippet);
      if (result.sessionRepository) parts.push(`\nRepo: ${result.sessionRepository}`);
      await navigator.clipboard.writeText(parts.join('\n'));
      return true;
    } catch { return false; }
  }

  return { copyResultsToClipboard, copySingleResult };
}
