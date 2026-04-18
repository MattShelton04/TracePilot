<script setup lang="ts">
import { useTodoDependencyGraphContext } from "@/composables/useTodoDependencyGraph";

interface EdgeData {
  id: string;
  d: string;
  color: string;
  status: string;
  from: string;
  to: string;
}

const props = defineProps<{ edge: EdgeData }>();

const ctx = useTodoDependencyGraphContext();
</script>

<template>
  <path
    :class="ctx.edgeClass(props.edge)"
    :d="props.edge.d"
    :stroke="props.edge.color"
    :opacity="ctx.edgeOpacity(props.edge)"
    :marker-end="`url(#arrow-${props.edge.status})`"
  />
</template>
