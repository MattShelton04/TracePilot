<script setup lang="ts">
import type { TodoItem } from "@tracepilot/types";
import { truncateText } from "@tracepilot/ui";
import { useTodoDependencyGraphContext } from "@/composables/useTodoDependencyGraph";
import { STATUS_ICON } from "./constants";

const props = defineProps<{ todo: TodoItem }>();

const ctx = useTodoDependencyGraphContext();

const NODE_W = 170;
const NODE_H = 54;
</script>

<template>
  <g
    :class="ctx.nodeClass(props.todo)"
    :data-id="props.todo.id"
    @click="ctx.onNodeClick(props.todo.id)"
    @mouseenter="ctx.onNodeEnter(props.todo.id)"
    @mouseleave="ctx.onNodeLeave()"
  >
    <rect
      :class="['node-rect', props.todo.status]"
      :x="ctx.layout.value[props.todo.id]?.x ?? 0"
      :y="ctx.layout.value[props.todo.id]?.y ?? 0"
      :width="NODE_W"
      :height="NODE_H"
      :stroke-dasharray="props.todo.status === 'blocked' ? '6 3' : undefined"
    />
    <text
      class="node-status-icon"
      :x="(ctx.layout.value[props.todo.id]?.x ?? 0) + 10"
      :y="(ctx.layout.value[props.todo.id]?.y ?? 0) + 20"
      :fill="ctx.statusColor.value[props.todo.status]?.text ?? ctx.statusColor.value.pending.text"
    >{{ STATUS_ICON[props.todo.status] ?? "○" }}</text>
    <text
      class="node-title"
      :x="(ctx.layout.value[props.todo.id]?.x ?? 0) + 26"
      :y="(ctx.layout.value[props.todo.id]?.y ?? 0) + 20"
    >{{ truncateText(props.todo.title, 18) }}</text>
    <text
      class="node-desc"
      :x="(ctx.layout.value[props.todo.id]?.x ?? 0) + 10"
      :y="(ctx.layout.value[props.todo.id]?.y ?? 0) + 38"
    >{{ truncateText(props.todo.description ?? "", 28) }}</text>
  </g>
</template>
