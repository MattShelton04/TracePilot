<script setup lang="ts">
import type { SkillInvocationRecord } from "@tracepilot/types";
import {
  Banner,
  EmptyState,
  formatRelativeTime,
  LoadingSpinner,
  normalizePath,
  useAsyncGuard,
} from "@tracepilot/ui";
import { onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import {
  findHistoricalSkillSource,
  type HistoricalSkillSource,
} from "@/utils/skills/historicalSource";

const props = defineProps<{ records: SkillInvocationRecord[]; usageLoading: boolean }>();
const router = useRouter();
const source = shallowRef<HistoricalSkillSource | null>(null);
const loading = ref(false);
const guard = useAsyncGuard();
onBeforeUnmount(() => guard.invalidate());
watch(
  () => props.records,
  async (records) => {
    const token = guard.start();
    source.value = null;
    loading.value = true;
    const result = await findHistoricalSkillSource(records, () => guard.isValid(token));
    if (!guard.isValid(token)) return;
    source.value = result;
    loading.value = false;
  },
  { immediate: true },
);

function openSourceSession() {
  const record = source.value?.invocation;
  if (!record) return;
  pushRoute(router, ROUTE_NAMES.sessionConversation, {
    params: { id: record.sessionId },
    query: { turn: String(record.turnIndex), event: String(record.eventIndex) },
  });
}
</script>

<template>
  <div class="historical-source panel-scroll">
    <Banner tone="info" title="Not installed · read-only">
      No installed definition is available. Recorded copies may differ from the last installed version or other skills with the same name.
    </Banner>
    <p v-if="loading || usageLoading" class="historical-source__loading"><LoadingSpinner size="sm" /> Looking for recorded content…</p>
    <template v-else-if="source">
      <div class="historical-source__provenance">
        <p>Recorded <span :title="source.invocation.timestamp ?? undefined">{{ source.invocation.timestamp ? formatRelativeTime(source.invocation.timestamp) : 'in a session' }}</span> · verified against the recorded invocation.</p>
        <p v-if="source.invocation.path" class="historical-source__path">{{ normalizePath(source.invocation.path) }}</p>
        <button type="button" class="btn-ghost btn-ghost--sm" @click="openSourceSession">Open source session</button>
      </div>
      <pre class="historical-source__content" tabindex="0" aria-label="Recorded skill content">{{ source.content }}</pre>
    </template>
    <EmptyState v-else title="No recorded copy available"
      description="No recoverable skill content was found in the recent invocations for this range. Older logs may omit the content or no longer be available. Usage remains available alongside." />
  </div>
</template>

<style scoped>
.historical-source {
  padding: 16px;
  gap: 16px;
}
.historical-source > * {
  flex-shrink: 0;
}
.historical-source__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}
.historical-source__provenance {
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.historical-source__provenance p {
  margin: 0 0 12px;
}
.historical-source__path {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
}
.historical-source__content {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 0.8125rem/1.7 var(--font-mono);
  color: var(--text-primary);
}
</style>
