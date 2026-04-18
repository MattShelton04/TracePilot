<script setup lang="ts">
// Static legend bar. Kept as its own component so the shell stays small.
</script>

<template>
  <div class="legend-bar">
    <div class="legend-item">
      <div class="legend-swatch done"></div> Done (✓)
    </div>
    <div class="legend-item">
      <div class="legend-swatch in_progress"></div> In Progress (●)
    </div>
    <div class="legend-item">
      <div class="legend-swatch pending"></div> Pending (○)
    </div>
    <div class="legend-item">
      <div class="legend-swatch blocked"></div> Blocked (⊘)
    </div>
    <div class="legend-item legend-direction">
      <svg width="24" height="8">
        <path
          d="M0,4 C8,4 16,4 24,4"
          stroke="var(--text-placeholder)"
          stroke-width="1.5"
          fill="none"
          marker-end="url(#legend-arrow)"
        />
      </svg>
      Dependency direction
    </div>
  </div>
</template>
