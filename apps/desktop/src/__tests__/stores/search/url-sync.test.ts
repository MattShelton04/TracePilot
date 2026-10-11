// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  emptySearchResponse,
  flushSearchQueue,
  mocks,
  resetAllMocks,
  setupDefaultMocks,
} from "./setup";
import { useSearchUrlSync } from "../../../composables/useSearchUrlSync";
import { useSearchStore } from "../../../stores/search";

const SearchPage = defineComponent({
  setup() {
    useSearchUrlSync();
    return () => null;
  },
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/search", component: SearchPage },
      { path: "/elsewhere", component: { render: () => null } },
    ],
  });
}

async function mountAt(router: ReturnType<typeof makeRouter>, path: string) {
  await router.push(path);
  const wrapper = mount(SearchPage, { global: { plugins: [router] } });
  await flushSearchQueue();
  return wrapper;
}

describe("useSearchUrlSync", () => {
  beforeEach(() => {
    setupPinia();
    resetAllMocks();
    setupDefaultMocks();
  });

  it("drops the previous query's results when the page is reopened without q", async () => {
    mocks.searchContent.mockResolvedValue({
      ...emptySearchResponse,
      results: [{ id: 1, sessionId: "s-1", snippet: "<mark>worktree</mark>" }],
      totalCount: 1,
    });
    const router = makeRouter();
    const store = useSearchStore();

    const first = await mountAt(router, "/search?q=worktree");
    expect(store.query).toBe("worktree");
    expect(store.results).toHaveLength(1);
    first.unmount();
    await router.push("/elsewhere");

    // The sidebar link carries no query: the box empties, so must the results.
    await mountAt(router, "/search");
    expect(store.query).toBe("");
    expect(store.results).toEqual([]);
    expect(store.totalCount).toBe(0);
    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
  });
});
