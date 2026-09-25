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
import AgentChip from "../agentComms/AgentChip.vue";
import AgentStatusPill from "../agentComms/AgentStatusPill.vue";
import MarkdownContent from "../MarkdownContent.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{ "load-full": [] }>();

const roster = computed(() => parseListAgentsResult(props.content));

const hint = computed(() => {
  const r = roster.value;
  if (!r) return undefined;
  const scope = r.scope && r.scope !== "default" ? `${r.scope} · ` : "";
  return proseHint(`${scope}${r.total} ${r.total === 1 ? "agent" : "agents"}`);
});
</script>

<template>
  <RendererShell
    tool-name="List agents"
    :status="tc.success === false ? 'error' : 'success'"
    :primary-hint="hint"
    :copy-text="content"
  >
    <template #icon><Users :size="16" /></template>

    <div v-if="roster" class="la-body">
      <p v-if="roster.total === 0" class="la-empty">No background agents.</p>
      <section v-for="group in roster.groups" :key="group.label" class="la-group">
        <header class="la-group-header">
          <AgentStatusPill :status="group.status" />
          <span class="la-group-count">{{ group.agents.length }}</span>
        </header>
        <ul class="la-agents">
          <li v-for="agent in group.agents" :key="agent.agentId" class="la-agent">
            <AgentChip :identifier="agent.agentId" :fallback-label="agent.name" />
            <span v-if="agent.relation" class="la-relation">{{ agent.relation }}</span>
            <span v-if="agent.oneShot" class="la-relation" title="MCP background task: read-only">one-shot</span>
            <span class="la-description" :title="agent.description">{{ agent.description }}</span>
            <span class="la-meta">
              <span v-if="agent.agentType">{{ agent.agentType }}</span>
              <span v-if="agent.model">{{ agent.model }}</span>
              <span v-if="agent.elapsedSeconds != null">{{ formatAgentAge(agent.elapsedSeconds) }}</span>
            </span>
          </li>
        </ul>
      </section>
    </div>

    <MarkdownContent v-else :content="content" :render="false" class="la-fallback" />
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.la-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
}
.la-empty {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.75rem;
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
  font-size: 0.6875rem;
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
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
  padding: 5px 0;
  font-size: 0.75rem;
}
.la-agent + .la-agent {
  border-top: 1px solid var(--border-muted);
}
.la-relation {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
  color: var(--text-secondary);
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.la-description {
  flex: 1 1 160px;
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.la-meta {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}
.la-fallback {
  padding: 10px 12px;
}
</style>
