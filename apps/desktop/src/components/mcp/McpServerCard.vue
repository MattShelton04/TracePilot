<script setup lang="ts">
import type { McpServerDetail } from "@tracepilot/types";
import { computed } from "vue";
import { useRouter } from "vue-router";
import McpStatusDot from "./McpStatusDot.vue";

const props = defineProps<{
  server: McpServerDetail;
}>();

const emit = defineEmits<{
  toggle: [name: string];
  remove: [name: string];
}>();

const router = useRouter();

const iconLetter = computed(() => props.server.name.charAt(0).toUpperCase());

const transportLabel = computed(() => props.server.config.type ?? props.server.config.transport ?? "stdio");

const healthStatus = computed(() => {
  if (!props.server.config.enabled) return "disabled" as const;
  return props.server.health?.status ?? ("unknown" as const);
});

const cardStatusClass = computed(() => {
  if (!props.server.config.enabled) return "status-paused";
  const s = props.server.health?.status;
  if (s === "unreachable" || s === "degraded") return "status-error";
  return "status-active";
});

const statusText = computed(() => {
  if (!props.server.config.enabled) return "Paused";
  const s = props.server.health?.status;
  if (s === "healthy") return "Active";
  if (s === "unreachable") return "Error";
  if (s === "degraded") return "Degraded";
  return "Active";
});

const statusDotClass = computed(() => {
  if (!props.server.config.enabled) return "dot-paused";
  const s = props.server.health?.status;
  if (s === "unreachable" || s === "degraded") return "dot-error";
  return "dot-active";
});

const tokensFormatted = computed(() => {
  const t = props.server.totalTokens;
  return t >= 1000 ? `~${(t / 1000).toFixed(1)}k` : `~${t}`;
});

const description = computed(() => {
  const s = props.server.health?.status;
  if (s === "unreachable" && props.server.health?.errorMessage) {
    return props.server.health.errorMessage;
  }
  return props.server.config.description ?? "";
});

const toggleLabel = computed(() => {
  if (!props.server.config.enabled) return "Paused";
  const s = props.server.health?.status;
  if (s === "unreachable" || s === "degraded") return "Retry";
  return "Active";
});

const toggleClass = computed(() => {
  if (!props.server.config.enabled) return "toggle-paused";
  const s = props.server.health?.status;
  if (s === "unreachable" || s === "degraded") return "";
  return "toggle-active";
});

function navigateToDetail() {
  router.push({ name: "mcp-server-detail", params: { name: props.server.name } });
}

function handleToggle(event: Event) {
  event.stopPropagation();
  emit("toggle", props.server.name);
}

function handleRemove(event: Event) {
  event.stopPropagation();
  emit("remove", props.server.name);
}

function handleConfigure(event: Event) {
  event.stopPropagation();
  navigateToDetail();
}
</script>

<template>
  <div
    class="server-card"
    :class="cardStatusClass"
    role="button"
    tabindex="0"
    @click="navigateToDetail"
    @keydown.enter="navigateToDetail"
  >
    <div class="server-card-top">
      <div class="server-icon-card">{{ iconLetter }}</div>
      <div class="server-info">
        <div class="server-name-row">
          <span class="server-name">{{ server.name }}</span>
          <McpStatusDot :status="healthStatus" :size="8" />
        </div>
        <div v-if="description" class="server-desc" :class="{ 'desc-error': cardStatusClass === 'status-error' }">
          {{ description }}
        </div>
      </div>
    </div>

    <div class="server-badges">
      <span class="badge-xs badge-tools">🔧 {{ server.tools.length }} tools</span>
      <span class="badge-xs badge-transport">{{ transportLabel }}</span>
      <span class="badge-xs badge-tokens">⚡ {{ tokensFormatted }} tok</span>
    </div>

    <div v-if="server.config.tags?.length" class="server-tags">
      <span v-for="tag in server.config.tags" :key="tag" class="tag">{{ tag }}</span>
    </div>

    <div class="server-card-actions">
      <button class="action-btn" title="Configure" @click="handleConfigure">
        <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.422 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.422 1.6-1.185 1.184l-.292-.159a1.873 1.873 0 00-2.692 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.693-1.115l-.291.16c-.764.415-1.6-.422-1.184-1.185l.159-.292A1.873 1.873 0 001.945 8.93l-.318-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.375l-.16-.291c-.415-.764.422-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.116l.094-.318z"/></svg>
        Configure
      </button>
      <button
        class="action-btn"
        :class="toggleClass"
        :title="server.config.enabled ? 'Click to pause' : 'Click to resume'"
        @click="handleToggle"
      >
        <svg v-if="server.config.enabled" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>
        <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><circle cx="8" cy="8" r="5"/><rect x="6" y="5.5" width="1.5" height="5" rx="0.5" fill="currentColor"/><rect x="8.5" y="5.5" width="1.5" height="5" rx="0.5" fill="currentColor"/></svg>
        {{ toggleLabel }}
      </button>
      <span class="action-spacer" />
      <button class="action-btn danger" title="Remove" @click="handleRemove">
        <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zM11 3V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.67l.83 9.41A1.75 1.75 0 006 15.5h4a1.75 1.75 0 001.75-1.59l.83-9.41h.67a.75.75 0 000-1.5H11z"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.server-card {
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 16px;
  transition: all var(--transition-normal);
  position: relative;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0;
  animation: card-in 0.35s ease backwards;
}

.server-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  opacity: 0;
  transition: opacity var(--transition-normal);
}

.server-card:hover {
  border-color: var(--border-accent);
  box-shadow: var(--shadow-md), 0 0 0 1px var(--border-glow);
  transform: translateY(-2px);
}

.server-card:hover::before {
  opacity: 1;
}

.server-card:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}

.server-card.status-active::before {
  background: var(--gradient-accent);
}

.server-card.status-paused::before {
  background: var(--warning-fg);
}

.server-card.status-error::before {
  background: var(--danger-fg);
  opacity: 1;
}

.server-card.status-error {
  border-color: var(--danger-muted);
}

.server-card:hover .server-name {
  color: var(--accent-fg);
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.server-card:nth-child(1) { animation-delay: 0.04s; }
.server-card:nth-child(2) { animation-delay: 0.08s; }
.server-card:nth-child(3) { animation-delay: 0.12s; }
.server-card:nth-child(4) { animation-delay: 0.16s; }
.server-card:nth-child(5) { animation-delay: 0.20s; }
.server-card:nth-child(6) { animation-delay: 0.24s; }

.server-card-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.server-icon-card {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  background: var(--canvas-default);
  color: var(--accent-fg);
  transition: all var(--transition-normal);
}

.server-card:hover .server-icon-card {
  border-color: var(--border-accent);
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.08);
}

.server-card.status-error .server-icon-card {
  border-color: var(--danger-muted);
  background: var(--danger-subtle);
  color: var(--danger-fg);
}

.server-info {
  flex: 1;
  min-width: 0;
}

.server-name-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 2px;
}

.server-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color var(--transition-fast);
}

.server-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.desc-error {
  color: var(--danger-fg);
}

.server-badges {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.badge-xs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  font-size: 0.625rem;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.badge-tools {
  background: var(--accent-muted);
  color: var(--accent-fg);
}

.badge-transport {
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: 0.03em;
}

.badge-tokens {
  background: var(--success-subtle);
  color: var(--success-fg);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: 0.01em;
}

.server-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}

.tag {
  font-size: 0.6875rem;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
}

.server-card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 10px;
  margin-top: auto;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  background: none;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.action-btn:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.action-btn.toggle-active {
  color: var(--success-fg);
}

.action-btn.toggle-active:hover {
  background: var(--success-subtle);
  color: var(--success-fg);
  border-color: rgba(52, 211, 153, 0.2);
}

.action-btn.toggle-paused {
  color: var(--warning-fg);
}

.action-btn.toggle-paused:hover {
  background: var(--warning-subtle);
  color: var(--warning-fg);
  border-color: rgba(251, 191, 36, 0.2);
}

.action-btn.danger:hover {
  color: var(--danger-fg);
  background: var(--danger-subtle);
  border-color: rgba(251, 113, 133, 0.15);
}

.action-spacer {
  flex: 1;
}
</style>