import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import { useClientPager } from "../useClientPager";

describe("useClientPager", () => {
  it("slices rows into pages", () => {
    const rows = ref(Array.from({ length: 5 }, (_, i) => i));
    const { page, pageCount, pageRows } = useClientPager(rows, 2);
    expect(pageCount.value).toBe(3);
    expect(pageRows.value).toEqual([0, 1]);
    page.value = 2;
    expect(pageRows.value).toEqual([4]);
  });

  it("returns to the first page when a reset source changes", async () => {
    const filter = ref(false);
    const { page } = useClientPager(
      Array.from({ length: 10 }, (_, i) => i),
      2,
      [filter],
    );
    page.value = 3;
    filter.value = true;
    await nextTick();
    expect(page.value).toBe(0);
  });

  it("clamps the page when rows shrink", async () => {
    const rows = ref(Array.from({ length: 10 }, (_, i) => i));
    const { page, pageCount } = useClientPager(rows, 2);
    page.value = 4;
    rows.value = [1, 2, 3];
    await nextTick();
    expect(pageCount.value).toBe(2);
    expect(page.value).toBe(1);
  });

  it("always has at least one page", () => {
    const { pageCount, pageRows } = useClientPager([], 20);
    expect(pageCount.value).toBe(1);
    expect(pageRows.value).toEqual([]);
  });
});
