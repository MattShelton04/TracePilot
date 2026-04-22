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
});
