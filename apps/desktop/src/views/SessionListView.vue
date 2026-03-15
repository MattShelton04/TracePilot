<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { useSessionsStore, type SortOption } from "@/stores/sessions";
import { formatRelativeTime } from "@tracepilot/ui";
import { SearchInput, FilterSelect, Badge, ErrorAlert, SkeletonLoader, EmptyState } from "@tracepilot/ui";

const router = useRouter();
const store = useSessionsStore();

const repoOptions = computed(() => store.repositories as string[]);
const branchOptions = computed(() => store.branches as string[]);
const sortOptions = [
  { label: "Newest first", value: "updated" },
  { label: "Oldest first", value: "oldest" },
  { label: "Most events", value: "events" },
  { label: "Most turns", value: "turns" },
];

function onSelect(sessionId: string) {
  router.push({ name: "session-overview", params: { id: sessionId } });
}

onMounted(() => {
  if (store.sessions.length === 0) {
    store.fetchSessions();
  }
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">

      <!-- Toolbar -->
      <div class="toolbar" style="display: flex; gap: 12px; align-items: center; margin-bottom: 20px;">
        <SearchInput v-model="store.searchQuery" placeholder="Search sessions…" shortcut-hint="⌘K" />
        <FilterSelect v-model="store.filterRepo" :options="repoOptions" placeholder="All Repos" />
        <FilterSelect v-model="store.filterBranch" :options="branchOptions" placeholder="All Branches" />
        <select
          :value="store.sortBy"
          class="filter-select"
          aria-label="Sort sessions"
          @change="store.sortBy = ($event.target as HTMLSelectElement).value as SortOption"
        >
          <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <span class="session-count-label">
          {{ store.filteredSessions.length }} session{{ store.filteredSessions.length !== 1 ? 's' : '' }}
        </span>
      </div>

      <!-- Error state -->
      <ErrorAlert v-if="store.error" :message="store.error" />

      <!-- Loading skeleton -->
      <SkeletonLoader v-if="store.loading" variant="card" :count="6" />

      <!-- Session cards grid -->
      <div v-else-if="store.filteredSessions.length > 0" class="grid-cards">
        <router-link
          v-for="session in store.filteredSessions"
          :key="session.id"
          :to="{ name: 'session-overview', params: { id: session.id } }"
          class="card card-interactive"
          style="text-decoration: none; color: inherit;"
        >
          <div class="session-card-title">{{ session.summary || 'Untitled Session' }}</div>
          <div class="session-card-badges">
            <Badge v-if="session.repository" variant="accent">{{ session.repository }}</Badge>
            <Badge v-if="session.branch" variant="success">{{ session.branch }}</Badge>
            <Badge v-if="session.currentModel" variant="done">{{ session.currentModel }}</Badge>
            <Badge variant="neutral">{{ session.hostType || 'cli' }}</Badge>
          </div>
          <div class="session-card-footer">
            <div class="session-card-stats">
              <span class="session-card-stat">{{ session.eventCount ?? 0 }} events</span>
              <span class="session-card-stat">{{ session.turnCount ?? 0 }} turns</span>
            </div>
            <span>{{ formatRelativeTime(session.updatedAt) }}</span>
          </div>
        </router-link>
      </div>

      <!-- Empty state -->
      <EmptyState
        v-else-if="!store.loading"
        icon="🔍"
        title="No sessions found"
        message="Try adjusting your search or filters."
      />

    </div>
  </div>
</template>

<style scoped>
.session-count-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-left: auto;
  white-space: nowrap;
}
.session-card-stats {
  display: flex;
  gap: 12px;
}
</style>
