/**
 * Run all tasks in parallel (like `Promise.allSettled`) and return the results
 * keyed by the same property names as the input object.
 *
 * This is a type-safe, named alternative to positional array destructuring of
 * `Promise.allSettled` results. Positional destructuring is order-coupled:
 * adding or reordering a promise silently mismatches variables. Keyed results
 * make each binding self-documenting and resilient to future edits.
 *
 * **Ordering note:** relies on the ES2015+ string-key insertion-order guarantee
 * for `Object.entries` / `Object.values`. Do not use integer-like string keys
 * (e.g. `"0"`, `"1"`) as they would sort numerically.
 *
 * @example
 * ```ts
 * const settled = await allSettledRecord({
 *   agents: getAgentDefinitions(),
 *   config: getCopilotConfig(),
 *   versions: discoverCopilotVersions(),
 * });
 *
 * if (settled.agents.status === "fulfilled") agents.value = settled.agents.value;
 * if (settled.config.status === "fulfilled") config.value = settled.config.value;
 *
 * // Compose with aggregateSettledErrors via Object.values:
 * error.value = aggregateSettledErrors(Object.values(settled));
 * ```
 */
export async function allSettledRecord<T extends Record<string, PromiseLike<unknown>>>(
  tasks: T,
): Promise<{ [K in keyof T]: PromiseSettledResult<Awaited<T[K]>> }> {
  // Capture entries once to guarantee key↔index alignment across both
  // Object.entries iterations (extraction and reconstruction).
  const entries = Object.entries(tasks) as [keyof T & string, PromiseLike<unknown>][];
  const results = await Promise.allSettled(entries.map(([, p]) => p));
  return Object.fromEntries(
    entries.map(([key], i) => [key, results[i]]),
  ) as { [K in keyof T]: PromiseSettledResult<Awaited<T[K]>> };
}
