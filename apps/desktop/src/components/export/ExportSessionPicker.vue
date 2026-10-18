<script setup lang="ts">
import type { SessionListItem, SessionSectionsInfo } from "@tracepilot/types";
import { isNonCopilotSource, modelDisplayName, sourceLabel } from "@tracepilot/types";
import { Badge, projectLabelFromCwd } from "@tracepilot/ui";
import { computed } from "vue";
import SessionPicker from "@/components/SessionPicker.vue";
import { plural } from "@/utils/format";

const props = defineProps<{
  sessions: readonly SessionListItem[];
  selectedSessionId: string;
  selectedSession: SessionListItem | undefined;
  sectionsInfo: SessionSectionsInfo | null;
}>();

const emit = defineEmits<(e: "select", id: string) => void>();

/** The working directory's folder, for a session with no repository. */
const folderProject = computed(() =>
  props.selectedSession && !props.selectedSession.repository
    ? projectLabelFromCwd(props.selectedSession.cwd)
    : null,
);
</script>

<template>
  <section class="config-section">
    <h3 class="config-section-title">Session</h3>
    <SessionPicker
      :sessions="sessions"
      :selected-id="selectedSessionId"
      label="Session to export"
      @select="emit('select', $event)"
    />
    <div v-if="selectedSession" class="session-info">
      <div class="session-info-badges">
        <Badge v-if="isNonCopilotSource(selectedSession.source)" variant="claude" title="Session source">{{ sourceLabel(selectedSession.source) }}</Badge>
        <Badge v-if="selectedSession.repository" variant="accent">{{ selectedSession.repository }}</Badge>
        <Badge
          v-else-if="folderProject"
          variant="neutral"
          :title="selectedSession.cwd ?? undefined"
        >{{ folderProject }}</Badge>
        <Badge v-if="selectedSession.currentModel" variant="neutral" :title="selectedSession.currentModel">{{ modelDisplayName(selectedSession.currentModel, selectedSession.source) }}</Badge>
      </div>
      <div v-if="sectionsInfo" class="session-info-stats">
        <span v-if="sectionsInfo.turnCount != null">{{ plural(sectionsInfo.turnCount, "turn") }}</span>
        <span v-if="sectionsInfo.eventCount != null">· {{ plural(sectionsInfo.eventCount, "event") }}</span>
      </div>
    </div>
  </section>
</template>
