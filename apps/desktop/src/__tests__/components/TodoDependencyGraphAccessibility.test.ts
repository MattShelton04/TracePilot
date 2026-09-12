import type { TodoItem } from "@tracepilot/types";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import TodoDependencyGraph from "@/components/TodoDependencyGraph.vue";

const todos: TodoItem[] = [
  {
    id: "first",
    title: "Review the complete dependency graph",
    description: "Check all links",
    status: "in_progress",
  },
  {
    id: "second",
    title: "Publish local audit notes",
    description: "Summarize the review",
    status: "pending",
  },
];

let wrapper: VueWrapper | undefined;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

function renderGraph() {
  wrapper = mount(TodoDependencyGraph, {
    props: { todos, deps: [{ todoId: "second", dependsOn: "first" }] },
    attachTo: document.body,
  });
  return wrapper;
}

describe("Todo dependency graph keyboard access", () => {
  it("exposes full node titles and statuses, plus named zoom controls", () => {
    const graph = renderGraph();
    const node = graph.get('[data-id="first"]');
    expect(node.attributes("role")).toBe("button");
    expect(node.attributes("tabindex")).toBe("0");
    expect(node.attributes("aria-label")).toBe(
      "Review the complete dependency graph — In progress",
    );
    expect(node.attributes("aria-expanded")).toBe("false");
    expect(graph.get("svg.graph-svg").attributes("role")).toBe("group");
    for (const name of ["Zoom in", "Zoom out", "Fit to view"]) {
      expect(graph.find(`button[aria-label="${name}"]`).exists()).toBe(true);
    }
  });

  it.each([
    "Enter",
    " ",
  ])("opens details with %j and returns to the node on Escape", async (key) => {
    const graph = renderGraph();
    const node = graph.get('[data-id="first"]');
    (node.element as SVGGElement).focus();
    await node.trigger("keydown", { key });
    await flushPromises();

    const panel = graph.get('[role="region"]');
    expect(panel.attributes("aria-label")).toBe(
      "Todo details: Review the complete dependency graph",
    );
    expect(node.attributes("aria-expanded")).toBe("true");
    const close = panel.get('button[aria-label="Close detail panel"]');
    expect(document.activeElement).toBe(close.element);
    await close.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(graph.find(".detail-panel").exists()).toBe(false);
    expect(document.activeElement).toBe(node.element);
  });

  it("reveals pointer-opened details and restores focus to the latest selected node", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    const graph = renderGraph();
    await graph.get('[data-id="first"]').trigger("click");
    await flushPromises();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    const second = graph.get('[data-id="second"]');
    await second.trigger("click");
    await flushPromises();
    expect(graph.get(".detail-panel").text()).toContain("Publish local audit notes");
    const close = graph.get(".close-detail");
    expect(document.activeElement).toBe(close.element);
    await close.trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(second.element);
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(graph.get(".graph-viewport").element);
  });
});
