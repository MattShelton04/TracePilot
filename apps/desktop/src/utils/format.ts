/**
 * A count with its noun agreed: "1 turn", "2 turns", "0 turns".
 *
 * Pass `pluralNoun` for irregular plurals ("1 entry", "2 entries") and
 * `formatCount` to show the count formatted ("1,204 calls") while the noun
 * still agrees with the number itself.
 */
export function plural(
  count: number,
  noun: string,
  pluralNoun = `${noun}s`,
  formatCount: (count: number) => string = String,
): string {
  return `${formatCount(count)} ${count === 1 ? noun : pluralNoun}`;
}
