<script setup lang="ts">
import ModelEfficiencyMap from "./charts/ModelEfficiencyMap.vue";
import ModelMixTimeline from "./charts/ModelMixTimeline.vue";
import ModelProfiles from "./charts/ModelProfiles.vue";
import ModelSpendShift from "./charts/ModelSpendShift.vue";
</script>

<template>
  <div class="model-chart-pair mb-4">
    <ModelEfficiencyMap />
    <ModelSpendShift />
  </div>
  <ModelProfiles />
  <ModelMixTimeline />
</template>
