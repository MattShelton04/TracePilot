/**
 * What the search text (qualifiers already removed) will search for, mirroring
 * the indexer's FTS sanitizer (`sanitize_fts_query`) closely enough to explain
 * its result in the UI:
 * - only uppercase `AND`, `OR`, `NOT` are operators and `NEAR` is dropped;
 *   lowercase `and`/`or`/`not` are ordinary words;
 * - a term needs a letter or digit (`*`, `!!!` and `((` search for nothing);
 * - a `NOT` with no term before it is dropped with the term it negates,
 *   because FTS5 can't search for "everything except X".
 */
export interface SearchTextTerms {
  /** At least one term or phrase will be searched for. */
  hasTerms: boolean;
  /** The text opens with `NOT`, which needs a term before it. */
  startsWithNot: boolean;
}

const PHRASE = "\u0000phrase";
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

export function describeSearchText(text: string): SearchTextTerms {
  const tokens: string[] = [];
  // Closed quoted phrases are one term each; anything else splits into words.
  for (const match of text.matchAll(/"([^"]*)"|[\p{L}\p{N}_]+/gu)) {
    const phrase = match[1];
    if (phrase === undefined) tokens.push(match[0]);
    else if (HAS_WORD_CHAR.test(phrase)) tokens.push(PHRASE);
  }

  let terms = 0;
  let lastWasOperator = true;
  let skipNegated = false;
  for (const token of tokens) {
    if (token === "AND" || token === "OR" || token === "NOT") {
      skipNegated = token === "NOT" && lastWasOperator;
      if (!skipNegated) lastWasOperator = true;
      continue;
    }
    if (token === "NEAR" || (token !== PHRASE && !HAS_WORD_CHAR.test(token))) continue;
    if (skipNegated) {
      skipNegated = false;
      continue;
    }
    terms++;
    lastWasOperator = false;
  }

  const firstWord = tokens.find((t) => t !== "AND" && t !== "OR");
  return { hasTerms: terms > 0, startsWithNot: firstWord === "NOT" };
}
