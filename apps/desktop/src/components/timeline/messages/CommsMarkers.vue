<script setup lang="ts">
/** Arrowheads for each exchange kind; reference as `url(#<idBase>-<kind>)`. */
import { EDGE_KINDS } from "./commsVisuals";

defineProps<{ idBase: string }>();
</script>

<template>
  <defs>
    <marker
      v-for="kind in EDGE_KINDS"
      :id="`${idBase}-${kind}`"
      :key="kind"
      :class="`edge--${kind}`"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="8"
      markerHeight="8"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path class="comms-arrowhead" d="M0,0 L10,5 L0,10 z" />
    </marker>
    <marker
      :id="`${idBase}-failed`"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="8"
      markerHeight="8"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path class="comms-arrowhead comms-arrowhead--failed" d="M0,0 L10,5 L0,10 z" />
    </marker>
  </defs>
</template>

<style scoped>
.comms-arrowhead--failed {
  fill: var(--danger-fg);
}
</style>
