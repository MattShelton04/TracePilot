import type { TodoDep, TodoItem } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { defineComponent, h, provide, ref } from "vue";
import { describe, expect, it } from "vitest";

import TodoDepDetailSlideover from "@/components/todoDependencyGraph/TodoDepDetailSlideover.vue";
import TodoDepGraphEdge from "@/components/todoDependencyGraph/TodoDepGraphEdge.vue";
import TodoDepGraphLegend from "@/components/todoDependencyGraph/TodoDepGraphLegend.vue";
import TodoDepGraphNode from "@/components/todoDependencyGraph/TodoDepGraphNode.vue";
import TodoDepGraphToolbar from "@/components/todoDependencyGraph/TodoDepGraphToolbar.vue";
import {
  TodoDependencyGraphKey,
  useTodoDependencyGraph,
} from "@/composables/useTodoDependencyGraph";

function t(id: string, status: TodoItem["status"], title = id): TodoItem {
  return { id, title, description: "", status };
}

function makeProvider(todos: TodoItem[], deps: TodoDep[]) {
  return defineComponent({
    components: {
      TodoDepGraphToolbar,
      TodoDepGraphNode,
      TodoDepGraphEdge,
      TodoDepGraphLegend,
      TodoDepDetailSlideover,
    },
    props: ["slotName"],
    setup(props, { slots }) {
      const todosRef = ref(todos);
      const depsRef = ref(deps);
      const ctx = useTodoDependencyGraph({ todos: todosRef, deps: depsRef });
      provide(TodoDependencyGraphKey, ctx);
      return () => h("div", {}, slots.default ? slots.default({ ctx }) : []);
    },
  });
}

describe("TodoDependencyGraph children", () => {
  it("TodoDepGraphToolbar renders a chip per status with counts and toggles", async () => {
    const Provider = makeProvider(
      [t("a", "done"), t("b", "done"), t("c", "pending")],
      [],
    );
    const wrapper = mount(Provider, {
      slots: { default: () => h(TodoDepGraphToolbar) },
    });
    const chips = wrapper.findAll(".filter-chip");
    expect(chips.length).toBeGreaterThanOrEqual(4);
    expect(wrapper.text()).toContain("Done");
    expect(wrapper.text()).toContain("2"); // 2 done
  });

  it("TodoDepGraphNode renders an SVG <g> with title text", () => {
    const todo = t("a", "pending", "Hello World");
    const Provider = makeProvider([todo], []);
    const wrapper = mount(Provider, {
      slots: {
        default: () =>
          h("svg", {}, [h(TodoDepGraphNode, { todo })]),
      },
    });
    expect(wrapper.find("g.dag-node").exists()).toBe(true);
    expect(wrapper.text()).toContain("Hello World");
  });

  it("TodoDepGraphEdge renders a path with the provided stroke", () => {
    const Provider = makeProvider([t("a", "pending"), t("b", "pending")], []);
    const edge = {
      id: "edge-0",
      d: "M0,0 C0,10 20,10 20,20",
      color: "#ff00ff",
      status: "pending",
      from: "a",
      to: "b",
    };
    const wrapper = mount(Provider, {
      slots: {
        default: () => h("svg", {}, [h(TodoDepGraphEdge, { edge })]),
      },
    });
    const path = wrapper.find("path.dag-edge");
    expect(path.exists()).toBe(true);
    expect(path.attributes("stroke")).toBe("#ff00ff");
    expect(path.attributes("marker-end")).toBe("url(#arrow-pending)");
  });

  it("TodoDepGraphLegend renders all four swatches and the direction hint", () => {
    const Provider = makeProvider([], []);
    const wrapper = mount(Provider, {
      slots: { default: () => h(TodoDepGraphLegend) },
    });
    expect(wrapper.findAll(".legend-swatch")).toHaveLength(4);
    expect(wrapper.text()).toContain("Dependency direction");
  });

  it("TodoDepDetailSlideover is empty when nothing is selected and renders detail when selected", async () => {
    const todo = t("a", "in_progress", "Important");
    const Provider = defineComponent({
      components: { TodoDepDetailSlideover },
      setup() {
        const todosRef = ref([todo]);
        const depsRef = ref<TodoDep[]>([]);
        const ctx = useTodoDependencyGraph({ todos: todosRef, deps: depsRef });
        provide(TodoDependencyGraphKey, ctx);
        // Select the only node synchronously in setup so the slideover renders.
        ctx.onNodeClick("a");
        return { ctx };
      },
      render() {
        return h(TodoDepDetailSlideover);
      },
    });
    const wrapper = mount(Provider);
    expect(wrapper.text()).toContain("Important");
    await wrapper.find(".close-detail").trigger("click");
    expect(wrapper.find(".detail-panel").exists()).toBe(false);
  });
});
