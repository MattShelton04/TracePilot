/**
 * Compatibility re-export. The implementation lives in `./syntax/`.
 *
 * Existing imports of `./syntaxHighlight` continue to work; new code
 * should import from `./syntax` directly.
 */

export { _cacheSize, _clearCache, highlightLine, highlightSql } from "./syntax";
