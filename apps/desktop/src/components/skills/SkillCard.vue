<script setup lang="ts">
import { formatNumber as formatCompactNumber } from "@tracepilot/types";
import { DefinitionCard, Tooltip } from "@tracepilot/ui";
import { FolderGit2, Package, Sparkles } from "lucide-vue-next";
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { type DisplaySkillSummary, isEncounteredSkill } from "@/stores/skills/encountered";
import SkillScopeBadge from "./SkillScopeBadge.vue";
import { SKILL_TOKEN_ESTIMATE_TOOLTIP } from "./tokenEstimate";

const props = defineProps<{
  skill: DisplaySkillSummary;
}>();

const emit = defineEmits<{
  toggleEnabled: [dir: string, enabled: boolean];
  delete: [dir: string];
}>();

const router = useRouter();
const enablementTooltip = computed(() =>
  props.skill.disabledReason === "repository"
    ? "Disabled by repository settings; change the repository setting to enable it."
    : "Updates disabledSkills in Copilot user settings for future sessions.",
);
const isEncountered = computed(() => isEncounteredSkill(props.skill));
const canOpenEditor = computed(() => !isEncountered.value || Boolean(props.skill.directory));
const encounteredLabel = computed(() => {
  if (!isEncounteredSkill(props.skill)) return "";
  const count = props.skill.invocationCount;
  return `Seen ${count} time${count === 1 ? "" : "s"} in recent sessions`;
});
const sourceTitle = computed(() => {
  if (!isEncounteredSkill(props.skill)) return undefined;
  return props.skill.sourcePath
    ? `${encounteredLabel.value}: ${props.skill.sourcePath}`
    : encounteredLabel.value;
});
const isBuiltin = computed(() => props.skill.scope === "builtin");

function navigateToEditor() {
  if (!canOpenEditor.value) return;
  pushRoute(router, ROUTE_NAMES.skillEditor, {
    params: { name: props.skill.directory },
  });
}

function onToggle() {
  emit("toggleEnabled", props.skill.directory, !props.skill.enabled);
}

function onDelete() {
  if (isBuiltin.value) return;
  emit("delete", props.skill.directory);
}

function formatTokens(n: number): string {
  return `~${formatCompactNumber(n)}`;
}
</script>

<template>
  <DefinitionCard
    class="skill-card"
    :class="{ 'skill-card--static': !canOpenEditor }"
    :name="skill.name"
    :description="skill.description"
    :open-label="`Open skill ${skill.name}`"
    :interactive="canOpenEditor"
    @open="navigateToEditor"
  >
    <template #icon>
      <FolderGit2 v-if="skill.scope === 'repository'" :size="18" :stroke-width="1.75" />
      <Package v-else-if="skill.scope === 'builtin'" :size="18" :stroke-width="1.75" />
      <Sparkles v-else :size="18" :stroke-width="1.75" />
    </template>
    <template #badges>
      <SkillScopeBadge :scope="skill.scope" />
      <span v-if="isEncountered" class="badge-xs badge-encountered" :title="sourceTitle">
        Encountered
      </span>
      <span v-if="skill.assetCount > 0" class="badge-xs badge-files">
        {{ skill.assetCount }} file{{ skill.assetCount === 1 ? "" : "s" }}
      </span>
      <Tooltip :text="SKILL_TOKEN_ESTIMATE_TOOLTIP" position="bottom">
        <span class="badge-xs badge-tokens skill-card__token-estimate" tabindex="0">
          Discover {{ formatTokens(skill.frontmatterTokens) }} · On use +{{ formatTokens(skill.instructionTokens) }}
        </span>
      </Tooltip>
    </template>

    <template #footer>
    <div v-if="isEncountered" class="skill-card__actions skill-card__actions--static">
      <span class="encountered-meta" :title="sourceTitle">{{ encounteredLabel }}</span>
    </div>

    <div v-else class="skill-card__actions">
      <label class="toggle-switch">
        <input
          type="checkbox"
          :checked="skill.enabled"
          :disabled="skill.disabledReason === 'repository'"
          :aria-label="`Enable skill ${skill.name}`"
          :title="enablementTooltip"
          @change="onToggle"
        />
        <span class="toggle-track" />
        <span class="toggle-label" :title="enablementTooltip">{{ skill.enabled ? "Enabled" : "Disabled" }}</span>
      </label>

      <div class="card-hover-actions">
        <button type="button" class="action-btn" :title="isBuiltin ? 'View skill' : 'Edit skill'" :aria-label="`${isBuiltin ? 'View' : 'Edit'} skill ${skill.name}`" @click="navigateToEditor">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 13l4-1L14 4l-2-2L4 10l-1 4z" /><path d="M10 4l2 2" />
          </svg>
        </button>
        <button v-if="!isBuiltin" type="button" class="action-btn action-btn--danger" title="Remove skill" :aria-label="`Remove skill ${skill.name}`" @click="onDelete">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 1.25V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.67l.83 9.41A1.75 1.75 0 006 15.5h4a1.75 1.75 0 001.75-1.59l.83-9.41h.67a.75.75 0 000-1.5H11z" />
          </svg>
        </button>
      </div>
    </div>
    </template>
  </DefinitionCard>
</template>

<style scoped>
.badge-xs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: var(--radius-sm, 4px);
  font-size: 0.625rem;
  font-weight: 500;
}

.badge-files {
  background: var(--canvas-default, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  color: var(--text-tertiary);
}

.badge-tokens {
  background: var(--canvas-default, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  color: var(--text-tertiary);
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 0.5625rem;
}

.badge-encountered {
  background: color-mix(in srgb, var(--accent-muted) 55%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-fg) 18%, transparent);
  color: var(--accent-fg);
}

/* ── Card Actions (toggle + hover buttons) ──────────────── */
.skill-card__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
  z-index: 1;
}

.skill-card__actions--static {
  min-height: 29px;
}

.encountered-meta {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  user-select: none;
}

.toggle-switch:has(input:disabled) {
  cursor: not-allowed;
}

.toggle-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  width: 34px;
  height: 18px;
  border-radius: 9px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-default);
  position: relative;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.toggle-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition: all 0.2s ease;
}

.toggle-switch input:checked + .toggle-track {
  background: var(--accent-muted);
  border-color: var(--accent-emphasis);
}

.toggle-switch input:focus-visible + .toggle-track,
.action-btn:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

.toggle-switch input:checked + .toggle-track::after {
  transform: translateX(16px);
  background: var(--accent-fg);
  box-shadow: 0 0 6px rgba(129, 140, 248, 0.5);
}

.toggle-label {
  transition: color var(--transition-fast);
}

.toggle-switch input:checked ~ .toggle-label {
  color: var(--accent-fg);
}

.toggle-switch input:disabled + .toggle-track {
  opacity: 0.72;
}

.toggle-switch input:disabled ~ .toggle-label {
  opacity: 0.9;
}

/* Hover action buttons */
.card-hover-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transform: translateX(6px);
  transition: all 0.2s ease;
}

.skill-card:hover .card-hover-actions,
.skill-card:focus-within .card-hover-actions {
  opacity: 1;
  transform: translateX(0);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm, 4px);
  color: var(--text-tertiary);
  background: none;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.action-btn:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.action-btn svg {
  width: 13px;
  height: 13px;
}

.action-btn--danger:hover {
  color: var(--danger-fg);
  background: var(--danger-subtle, rgba(248, 81, 73, 0.1));
  border-color: rgba(251, 113, 133, 0.15);
}

</style>
