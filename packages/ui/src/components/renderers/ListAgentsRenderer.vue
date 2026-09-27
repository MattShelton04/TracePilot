<script setup lang="ts">
/**
 * ListAgentsRenderer — renders a `list_agents` roster grouped by status.
 *
 * Each row resolves to the session's agent where possible, and shows the
 * agent's relation to the caller (child, sibling, …), type, description,
 * model and age. Scoped listings (`siblings`, `children`, `all`) show their
 * scope in the header.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { Users } from "lucide-vue-next";
import { computed } from "vue";
import { formatAgentAge, parseListAgentsResult, proseHint } from "../../utils/agentComms";
import { toolCallStatus } from "../../utils/toolCallStatus";
import AgentChip from "../agentComms/AgentChip.vue";
import AgentStatusPill from "../agentComms/AgentStatusPill.vue";
import MarkdownContent from "../MarkdownContent.vue";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import RecordedToolResponse from "./RecordedToolResponse.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{ "load-full": [] }>();

const roster = computed(() => parseListAgentsResult(props.content));
const status = computed(() => toolCallStatus(props.tc));
const emptyRoster = computed(() => props.content.trim() === "<no background agents>");

const hint = computed(() => {
  const r = roster.value;
  const requestScope = typeof props.args.scope === "string" ? props.args.scope : undefined;
  if (!r) return requestScope;
  const value = r.scope ?? requestScope;
  const scope = value && value !== "default" ? `${value} · ` : "";
  return proseHint(`${scope}${r.total} ${r.total === 1 ? "agent" : "agents"}`);
});
</script>

<template>
  <RendererShell
    tool-name="List agents"
    :status="status"
    :primary-hint="hint"
    :copy-text="content"
  >
    <template #icon><Users :size="16" /></template>

    <RendererScrollRegion :label="roster?.total ? `${roster.total}-agent roster` : 'agent roster'">
    <div v-if="roster" class="la-body">
      <p v-if="roster.total === 0" class="la-empty">{{ emptyRoster ? 'No background agents.' : 'No recognized agent entries. See the raw response below.' }}</p>
      <section v-for="group in roster.groups" :key="group.label" class="la-group">
        <header class="la-group-header">
          <AgentStatusPill :status="group.status" />
          <span class="la-group-count">{{ group.agents.length }}</span>
        </header>
        <ul class="la-agents">
          <li v-for="agent in group.agents" :key="agent.agentId" class="la-agent">
            <div class="la-agent-heading">
              <AgentChip :identifier="agent.agentId" :fallback-label="agent.name" />
              <span v-if="agent.relation" class="la-relation">{{ agent.relation }}</span>
              <span v-if="agent.oneShot" class="la-relation" title="MCP background task: read-only">one-shot</span>
            </div>
            <span v-if="agent.description" class="la-description">{{ agent.description }}</span>
            <span class="la-meta">
              <span v-if="agent.agentType">{{ agent.agentType }}</span>
              <span v-if="agent.model">{{ agent.model }}</span>
              <span v-if="agent.elapsedSeconds != null">{{ formatAgentAge(agent.elapsedSeconds) }}</span>
            </span>
          </li>
        </ul>
      </section>
      <RecordedToolResponse :content="content" />
    </div>

    <MarkdownContent v-else-if="content" :content="content" :render="false" class="la-fallback" />
    <p v-else class="la-fallback la-empty">{{ status === 'pending' ? 'Waiting for agent roster…' : 'No response returned.' }}</p>
    </RendererScrollRegion>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.la-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.la-empty {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 13px;
  font-style: italic;
}
.la-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.la-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.la-group-count {
  color: var(--text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.la-agents {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.la-agent {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  padding: 10px 0;
  font-size: 13px;
}
.la-agent-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; max-width: 100%; }
.la-agent + .la-agent {
  border-top: 1px solid var(--border-muted);
}
.la-relation {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.la-description {
  min-width: 0;
  color: var(--text-secondary);
  white-space: pre-wrap;
  line-height: 1.5;
}
.la-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.la-fallback {
  margin: 0;
  padding: 12px;
  overflow-wrap: anywhere;
}
</style>
