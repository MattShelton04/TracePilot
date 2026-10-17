import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { resetScrollPositions, useScrollRestore } from "../useScrollRestore";

/** jsdom has no layout: give each scroller a settable offset and a fixed size. */
let contentHeight = 3000;
function fakeScroller(el: HTMLElement) {
  let top = 0;
  Object.defineProperties(el, {
    scrollTop: {
      get: () => top,
      set: (v: number) => {
        top = v;
      },
      configurable: true,
    },
    scrollHeight: { get: () => contentHeight, configurable: true },
    clientHeight: { get: () => 600, configurable: true },
  });
}

const filter = ref("all");
const loading = ref(false);
let scroller: HTMLElement | null = null;
/** Height each item is laid out with; off-screen placeholders can differ from rendered cards. */
let itemHeight = 200;
/** What the list's pending restore reported while it was being set up. */
let anchorAtSetup: string | undefined;
let pendingAnchorId: () => string | undefined = () => undefined;

/** Items whose box follows the fake scroll offset, like a real list. */
function fakeItem(el: HTMLElement, index: number) {
  el.getBoundingClientRect = () => {
    const top = index * itemHeight - (scroller?.scrollTop ?? 0);
    return { top, bottom: top + itemHeight } as DOMRect;
  };
}

const ListView = defineComponent({
  setup() {
    const el = ref<HTMLElement | null>(null);
    ({ pendingAnchorId } = useScrollRestore({
      key: () => `list:${filter.value}`,
      el,
      ready: () => !loading.value,
      anchorAttr: "data-id",
    }));
    anchorAtSetup = pendingAnchorId();
    return () =>
      loading.value
        ? h("p", "Loading")
        : h(
            "div",
            {
              class: "scroller",
              ref: (node) => {
                if (node && node !== scroller) {
                  fakeScroller(node as HTMLElement);
                  scroller = node as HTMLElement;
                }
                el.value = node as HTMLElement | null;
              },
            },
            Array.from({ length: 30 }, (_, i) =>
              h("article", {
                "data-id": `item-${i}`,
                ref: (node) => node && fakeItem(node as HTMLElement, i),
              }),
            ),
          );
  },
});
const DetailView = defineComponent({ render: () => h("p", "Detail") });

function setup() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: ListView },
      { path: "/session/:id", component: DetailView },
    ],
  });
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: { plugins: [router] },
  });
  return { router, wrapper };
}

async function go(router: ReturnType<typeof setup>["router"], to: string | number) {
  if (typeof to === "number") router.go(to);
  else await router.push(to);
  await flushPromises();
  await nextTick();
}

describe("useScrollRestore", () => {
  beforeEach(() => {
    resetScrollPositions();
    filter.value = "all";
    loading.value = false;
    contentHeight = 3000;
    itemHeight = 0;
    scroller = null;
    anchorAtSetup = undefined;
  });

  afterEach(() => {
    scroller = null;
  });

  it("returns to the saved offset after back from a detail route", async () => {
    const { router, wrapper } = setup();
    await go(router, "/");
    (scroller as HTMLElement).scrollTop = 1200;

    await go(router, "/session/a");
    expect(wrapper.text()).toBe("Detail");
    await go(router, -1);
    await flushPromises();

    expect(scroller?.scrollTop).toBe(1200);
    wrapper.unmount();
  });

  it("waits for loading to finish before restoring", async () => {
    const { router, wrapper } = setup();
    await go(router, "/");
    (scroller as HTMLElement).scrollTop = 900;
    await go(router, "/session/a");

    loading.value = true;
    scroller = null;
    await go(router, "/");
    expect(wrapper.text()).toBe("Loading");

    loading.value = false;
    await flushPromises();
    expect((scroller as HTMLElement | null)?.scrollTop).toBe(900);
    wrapper.unmount();
  });

  it("clamps to the content when it is now shorter", async () => {
    const { router, wrapper } = setup();
    await go(router, "/");
    (scroller as HTMLElement).scrollTop = 2400;
    await go(router, "/session/a");

    contentHeight = 1000;
    await go(router, "/");
    expect(scroller?.scrollTop).toBe(400);
    wrapper.unmount();
  });

  it("starts at the top when the list state differs from the saved one", async () => {
    const { router, wrapper } = setup();
    await go(router, "/");
    (scroller as HTMLElement).scrollTop = 1500;
    await go(router, "/session/a");

    filter.value = "repo-x";
    await go(router, "/");
    expect(scroller?.scrollTop).toBe(0);

    // The original state still has its own position.
    await go(router, "/session/b");
    filter.value = "all";
    await go(router, "/");
    expect(scroller?.scrollTop).toBe(1500);
    wrapper.unmount();
  });

  it("lines up the item that was at the top when off-screen items get placeholder heights", async () => {
    itemHeight = 200;
    contentHeight = 6000;
    const { router, wrapper } = setup();
    await go(router, "/");
    // Item 6 spans 1200–1400, so it is the top item, 50px above the edge.
    (scroller as HTMLElement).scrollTop = 1250;
    await go(router, "/session/a");

    // Back on the list, items not yet rendered are laid out at 180px.
    itemHeight = 180;
    await go(router, -1);
    await flushPromises();

    expect(scroller?.scrollTop).toBe(6 * 180 + 50);
    const top = scroller?.querySelector<HTMLElement>('[data-id="item-6"]')?.getBoundingClientRect();
    expect(top?.top).toBe(-50);
    wrapper.unmount();
  });

  it("names the item to line up before the first render, until it is restored", async () => {
    itemHeight = 200;
    contentHeight = 6000;
    const { router, wrapper } = setup();
    await go(router, "/");
    expect(anchorAtSetup).toBeUndefined();
    (scroller as HTMLElement).scrollTop = 1250;
    await go(router, "/session/a");

    loading.value = true;
    await go(router, -1);
    await flushPromises();
    expect(anchorAtSetup).toBe("item-6");
    expect(pendingAnchorId()).toBe("item-6");

    loading.value = false;
    await flushPromises();
    expect(pendingAnchorId()).toBeUndefined();
    wrapper.unmount();
  });

  it("keeps the item in place when heights above it change before a paint", async () => {
    const resized: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resized.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    itemHeight = 200;
    contentHeight = 6000;
    const { router, wrapper } = setup();
    await go(router, "/");
    (scroller as HTMLElement).scrollTop = 1250;
    await go(router, "/session/a");
    await go(router, -1);
    await flushPromises();
    expect(scroller?.scrollTop).toBe(1250);

    // Cards near the viewport render at their real height after the restore.
    itemHeight = 150;
    for (const callback of resized) callback([], {} as ResizeObserver);
    expect(scroller?.scrollTop).toBe(6 * 150 + 50);
    vi.unstubAllGlobals();
    wrapper.unmount();
  });

  it("does not restore a stale offset once the user left from the top", async () => {
    const { router, wrapper } = setup();
    await go(router, "/");
    (scroller as HTMLElement).scrollTop = 800;
    await go(router, "/session/a");
    await go(router, "/");
    (scroller as HTMLElement).scrollTop = 0;
    await go(router, "/session/b");

    await go(router, "/");
    expect(scroller?.scrollTop).toBe(0);
    wrapper.unmount();
  });
});
