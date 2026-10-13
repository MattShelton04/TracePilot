<script setup lang="ts">
/** Overview: file-history checkpoints, for sources that back up files. */
import FileHistoryPanel from "@/components/checkpoints/FileHistoryPanel.vue";
import { useOverviewModel } from "./overviewModel";

const { store, anchor } = useOverviewModel();
const root = anchor("fileHistory");
</script>

<template>
  <div v-if="store.fileHistory.length > 0" ref="root" class="overview-anchor">
    <FileHistoryPanel :checkpoints="store.fileHistory" :session-id="store.sessionId" class="mb-6" />
  </div>
</template>
