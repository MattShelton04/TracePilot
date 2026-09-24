/**
 * useClientPager — Previous/Next paging over rows already in memory.
 *
 * The page resets to the first when any `resetOn` source changes (a new sort
 * or filter), and is clamped when the rows shrink under it.
 */
import { computed, type MaybeRefOrGetter, ref, toValue, type WatchSource, watch } from "vue";

export function useClientPager<T>(
  rows: MaybeRefOrGetter<readonly T[]>,
  pageSize: number,
  resetOn: WatchSource[] = [],
) {
  const page = ref(0);
  const pageCount = computed(() => Math.max(1, Math.ceil(toValue(rows).length / pageSize)));
  const pageRows = computed(() =>
    toValue(rows).slice(page.value * pageSize, (page.value + 1) * pageSize),
  );

  if (resetOn.length > 0) {
    watch(resetOn, () => {
      page.value = 0;
    });
  }
  watch(pageCount, (count) => {
    page.value = Math.min(page.value, count - 1);
  });

  return { page, pageCount, pageRows };
}
