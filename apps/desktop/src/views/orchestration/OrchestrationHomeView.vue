<script setup lang="ts">
import { ErrorState, LoadingOverlay, PageShell } from "@tracepilot/ui";
import { onMounted } from "vue";
import { useRenderBudget } from "@/composables/useRenderBudget";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";
import OrchestrationActivityFeed from "./home/OrchestrationActivityFeed.vue";
import OrchestrationHeroStats from "./home/OrchestrationHeroStats.vue";
import OrchestrationHomeHeader from "./home/OrchestrationHomeHeader.vue";
import OrchestrationQuickActions from "./home/OrchestrationQuickActions.vue";
import OrchestrationSystemHealth from "./home/OrchestrationSystemHealth.vue";

const store = useOrchestrationHomeStore();

useRenderBudget({
  key: "render.orchestrationHomeViewMs",
  budgetMs: 150,
  label: "OrchestrationHomeView",
});

onMounted(() => {
  store.initialize();
});
</script>

<template>
  <PageShell>
    <LoadingOverlay :loading="store.loading" message="Loading dashboard…">
      <ErrorState v-if="store.error" heading="Failed to load worktrees" :message="store.error" @retry="store.initialize()" />

      <template v-else>
        <div class="fade-section" style="--stagger: 0">
          <OrchestrationHomeHeader />
        </div>

        <div class="fade-section" style="--stagger: 1">
          <OrchestrationHeroStats />
        </div>

        <div class="two-col fade-section" style="--stagger: 2">
          <OrchestrationQuickActions />
          <OrchestrationActivityFeed />
        </div>

        <div class="fade-section" style="--stagger: 3">
          <OrchestrationSystemHealth />
        </div>
      </template>
    </LoadingOverlay>
  </PageShell>
</template>

<style scoped>
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-section {
  animation: fadeInUp 0.4s ease-out both;
  animation-delay: calc(var(--stagger, 0) * 0.08s);
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 28px;
}
</style>
