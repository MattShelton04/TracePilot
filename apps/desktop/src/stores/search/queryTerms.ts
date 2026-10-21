/**
 * What the search text (qualifiers already removed) will search for, mirroring
 * the indexer's FTS sanitizer (`sanitize_fts_query`) closely enough to explain
 * its result in the UI:
 * - only the bare uppercase words `AND`, `OR`, `NOT` are operators and a bare
 *   `NEAR` is dropped; lowercase `and`/`or`/`not` are ordinary words, and so
 *   is an operator word with a `*` (`OR*` searches for words starting "or");
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
const OPERATORS = new Set(["AND", "OR", "NOT"]);
// The sanitizer's `char::is_alphanumeric`.
const HAS_WORD_CHAR = /[\p{Alphabetic}\p{N}]/u;
// Characters the sanitizer turns into joiners between words; `*` and `_` stay.
const PUNCTUATION = /[^\p{Alphabetic}\p{N}\p{White_Space}"*_]+/u;
const EDGE_PUNCTUATION = new RegExp(`^${PUNCTUATION.source}|${PUNCTUATION.source}$`, "gu");

/**
 * Whether an unquoted word, edge punctuation already trimmed, is a term: one
 * of its punctuation-joined parts other than `NEAR` has a letter or digit.
 */
function isTerm(word: string): boolean {
  return word.split(PUNCTUATION).some((part) => part !== "NEAR" && HAS_WORD_CHAR.test(part));
}

export function describeSearchText(text: string): SearchTextTerms {
  const tokens: string[] = [];
  // Closed quoted phrases are one term each; anything else splits on spaces,
  // and a stray quote is skipped.
  for (const match of text.matchAll(/"([^"]*)"|[^"\p{White_Space}]+/gu)) {
    const phrase = match[1];
    if (phrase === undefined) {
      // `(NOT` is the operator NOT and `(error)` the word error.
      const word = match[0].replace(EDGE_PUNCTUATION, "");
      if (word !== "") tokens.push(word);
    } else if (HAS_WORD_CHAR.test(phrase)) tokens.push(PHRASE);
  }

  let terms = 0;
  let lastWasOperator = true;
  let skipNegated = false;
  let startsWithNot: boolean | undefined;
  for (const token of tokens) {
    if (OPERATORS.has(token)) {
      if (token === "NOT") startsWithNot ??= true;
      skipNegated = token === "NOT" && lastWasOperator;
      if (!skipNegated) lastWasOperator = true;
      continue;
    }
    if (token === "NEAR" || (token !== PHRASE && !isTerm(token))) continue;
    startsWithNot ??= false;
    if (skipNegated) {
      skipNegated = false;
      continue;
    }
    terms++;
    lastWasOperator = false;
  }

  return { hasTerms: terms > 0, startsWithNot: startsWithNot ?? false };
}
