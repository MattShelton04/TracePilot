<script setup lang="ts">
import type { SessionListItem, SessionSectionsInfo } from "@tracepilot/types";
import { Badge } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { filterSessionsBySubstring } from "@/utils/sessions";

const props = defineProps<{
  sessions: readonly SessionListItem[];
  selectedSessionId: string;
  selectedSession: SessionListItem | undefined;
  sectionsInfo: SessionSectionsInfo | null;
}>();

const emit = defineEmits<(e: "select", id: string) => void>();

const sessionSearchQuery = ref("");
const sessionDropdownOpen = ref(false);

const filteredSessions = computed(() =>
  filterSessionsBySubstring(props.sessions, sessionSearchQuery.value),
);

function onSelect(id: string) {
  emit("select", id);
  sessionDropdownOpen.value = false;
  sessionSearchQuery.value = "";
}
</script>

<template>
  <section class="config-section">
    <h3 class="config-section-title">Session</h3>
    <div class="session-picker" @focusin="sessionDropdownOpen = true">
      <input
        v-model="sessionSearchQuery"
        class="session-search-input"
        placeholder="Search sessions…"
        @focus="sessionDropdownOpen = true"
      />
      <div
        v-if="selectedSession && !sessionSearchQuery"
        class="session-search-selected"
        @click="sessionDropdownOpen = true"
      >
        {{ selectedSession.summary || selectedSession.id.slice(0, 12) }} — {{ selectedSession.repository ?? 'unknown' }}
      </div>
      <div v-if="sessionDropdownOpen" class="session-dropdown" @mouseleave="sessionDropdownOpen = false">
        <div v-if="filteredSessions.length === 0" class="session-dropdown-empty">
          No sessions match "{{ sessionSearchQuery }}"
        </div>
        <div
          v-for="s in filteredSessions"
          :key="s.id"
          class="session-dropdown-item"
          :class="{ selected: s.id === selectedSessionId }"
          @click="onSelect(s.id)"
        >
          <div class="session-dropdown-name">
            {{ s.summary || s.id.slice(0, 12) }}
          </div>
          <div class="session-dropdown-meta">
            {{ s.repository ?? 'unknown' }}
            <span v-if="s.currentModel"> · {{ s.currentModel }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="selectedSession" class="session-info">
      <div class="session-info-badges">
        <Badge variant="accent">{{ selectedSession.repository ?? '—' }}</Badge>
        <Badge variant="neutral">{{ selectedSession.currentModel ?? '—' }}</Badge>
      </div>
      <div v-if="sectionsInfo" class="session-info-stats">
        <span v-if="sectionsInfo.turnCount != null">{{ sectionsInfo.turnCount }} turns</span>
        <span v-if="sectionsInfo.eventCount != null">· {{ sectionsInfo.eventCount }} events</span>
      </div>
    </div>
  </section>
</template>
