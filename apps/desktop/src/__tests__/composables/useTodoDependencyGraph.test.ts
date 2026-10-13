import type { TodoDep, TodoItem } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";

import { useTodoDependencyGraph } from "@/composables/useTodoDependencyGraph";

function t(id: string, status: TodoItem["status"], title = id, description = ""): TodoItem {
  return { id, title, description, status };
}

/**
 * The composable reads from a viewport element in `onMounted`, so we always
 * mount it through a host component to exercise the full lifecycle.
 */
function mountHost(todos: TodoItem[], deps: TodoDep[]) {
  let ctx!: ReturnType<typeof useTodoDependencyGraph>;
  const Host = defineComponent({
    setup() {
      const todosRef = ref(todos);
      const depsRef = ref(deps);
      ctx = useTodoDependencyGraph({ todos: todosRef, deps: depsRef });
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, getCtx: () => ctx };
}

/** A detached element reporting a fixed client size, standing in for the graph viewport. */
function viewport(width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: width });
  Object.defineProperty(el, "clientHeight", { value: height });
  return el;
}

describe("useTodoDependencyGraph", () => {
  it("derives filteredTodos from activeStatuses and toggling respects 'at least one' invariant", () => {
    const { getCtx } = mountHost([t("a", "done"), t("b", "in_progress"), t("c", "blocked")], []);
    const ctx = getCtx();
    expect(ctx.filteredTodos.value).toHaveLength(3);

    // Toggling off 'done' filters it out
    ctx.toggleStatus("done");
    expect(ctx.filteredTodos.value.map((x: TodoItem) => x.id)).toEqual(["b", "c"]);

    // Toggling off the last status is a no-op (min 1 active)
    ctx.toggleStatus("in_progress");
    ctx.toggleStatus("blocked");
    expect(ctx.activeStatuses.value.size).toBeGreaterThanOrEqual(1);
  });

  it("search filters match titles/descriptions/ids case-insensitively", () => {
    const { getCtx } = mountHost(
      [
        t("alpha-1", "pending", "Login", "needs bcrypt"),
        t("beta-2", "pending", "Logout", "plain cookies"),
        t("gamma-3", "pending", "Refresh", "rotate token"),
      ],
      [],
    );
    const ctx = getCtx();
    ctx.searchQuery.value = "LOG";
    const ids = ctx.searchMatchIds.value;
    expect(ids).not.toBeNull();
    expect(ids?.has("alpha-1")).toBe(true);
    expect(ids?.has("beta-2")).toBe(true);
    expect(ids?.has("gamma-3")).toBe(false);
  });

  it("onNodeClick toggles selection and closeDetail clears it", () => {
    const { getCtx } = mountHost([t("a", "pending"), t("b", "pending")], []);
    const ctx = getCtx();
    expect(ctx.selectedTodo.value).toBeNull();

    ctx.onNodeClick("a");
    expect(ctx.selectedNodeId.value).toBe("a");
    expect(ctx.selectedTodo.value?.id).toBe("a");

    // Clicking again clears
    ctx.onNodeClick("a");
    expect(ctx.selectedNodeId.value).toBeNull();

    ctx.onNodeClick("b");
    ctx.closeDetail();
    expect(ctx.selectedNodeId.value).toBeNull();
  });

  it("edges are filtered when either endpoint is hidden, and layout reflects only visible nodes", () => {
    const { getCtx } = mountHost(
      [t("a", "done"), t("b", "pending"), t("c", "pending")],
      [
        { todoId: "b", dependsOn: "a" },
        { todoId: "c", dependsOn: "b" },
      ],
    );
    const ctx = getCtx();
    expect(ctx.edges.value).toHaveLength(2);

    // Hide 'done' → edge a→b should drop out
    ctx.toggleStatus("done");
    expect(ctx.edges.value).toEqual([{ from: "b", to: "c" }]);
    expect(ctx.layout.value.a).toBeUndefined();
    expect(ctx.layout.value.b).toBeDefined();
  });

  it("fit-to-view zooms a small graph in to fill the viewport, centred", () => {
    const { getCtx } = mountHost([t("a", "in_progress"), t("b", "done")], []);
    const ctx = getCtx();
    ctx.viewportRef.value = viewport(1100, 440);
    ctx.fitToView();
    const vb = ctx.viewBox.value;
    const fit = Math.min(1100 / vb.width, 440 / vb.height) * 0.9;
    expect(fit).toBeGreaterThan(1);
    expect(ctx.zoomLevel.value).toBeCloseTo(fit);
    expect(ctx.panX.value).toBeCloseTo((1100 - vb.width * fit) / 2);
    expect(ctx.panY.value).toBeCloseTo((440 - vb.height * fit) / 2);
  });

  it("fit-to-view still shrinks a graph larger than the viewport", () => {
    const todos = Array.from({ length: 12 }, (_, i) => t(`n${i}`, "pending"));
    const deps = todos.slice(1).map((todo, i) => ({ todoId: todo.id, dependsOn: todos[i].id }));
    const { getCtx } = mountHost(todos, deps);
    const ctx = getCtx();
    ctx.viewportRef.value = viewport(600, 300);
    ctx.fitToView();
    const vb = ctx.viewBox.value;
    expect(ctx.zoomLevel.value).toBeLessThan(1);
    expect(ctx.zoomLevel.value).toBeCloseTo(Math.min(600 / vb.width, 300 / vb.height) * 0.9);
  });
});
