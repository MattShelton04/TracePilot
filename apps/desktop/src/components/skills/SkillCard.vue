<script setup lang="ts">
/**
 * One skill in the manager grid: identity and scope, what it costs, and how
 * it has actually been used. A skill that sessions invoked but that is no
 * longer installed renders the same way minus the parts that need a file.
 */
import { formatNumber } from "@tracepilot/types";
import { Badge, DefinitionCard, formatRelativeTime, Tooltip } from "@tracepilot/ui";
import { FolderGit2, Package, Search, Sparkles } from "lucide-vue-next";
import { computed } from "vue";
import { useRouter } from "vue-router";
import UsageCardSummary, { type UsageCardStat } from "@/components/usage/UsageCardSummary.vue";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { type SkillEntry, shortenSkillPath } from "@/utils/skills/entries";
import { type UsageRange, zeroFilledDays } from "@/utils/usage/range";
import { SKILL_FLAG_BADGES, skillScopeBadge } from "./skillBadges";
import { SKILL_TOKEN_ESTIMATE_TOOLTIP } from "./tokenEstimate";

const props = defineProps<{
  entry: SkillEntry;
  range: UsageRange;
}>();

const emit = defineEmits<{
  toggleEnabled: [dir: string, enabled: boolean];
  delete: [dir: string];
}>();

const router = useRouter();

const skill = computed(() => props.entry.skill);
const usage = computed(() => props.entry.usage);
const isMissing = computed(() => props.entry.kind === "missing");
const isBuiltin = computed(() => props.entry.scope === "builtin");
const badge = computed(() => skillScopeBadge(props.entry.scope));
// The scope badge on a missing skill already reads "Not installed", so
// repeating it as a flag would put the same words twice on one card.
const badgeFlags = computed(() => props.entry.flags.filter((flag) => flag !== "missing"));

const enablementTooltip = computed(() =>
  skill.value?.disabledReason === "repository"
    ? "Disabled by repository settings; change the repository setting to enable it."
    : "Updates disabledSkills in Copilot user settings for future sessions.",
);

/**
 * A missing skill's last known path is the only way back to it, so it takes
 * the place of the enable toggle it cannot have.
 */
const missingHint = computed(() =>
  props.entry.lastKnownPath ? shortenSkillPath(props.entry.lastKnownPath) : "No path recorded",
);

const sparkValues = computed(() =>
  zeroFilledDays(usage.value?.dailyUses ?? [], props.range, usage.value?.firstUsed ?? null),
);

/**
 * Three labelled figures rather than one run-on sentence, so the same column
 * means the same thing on every card in the grid.
 */
const stats = computed<UsageCardStat[] | null>(() => {
  const value = usage.value;
  if (!value || value.uses === 0) return null;
  return [
    { key: "uses", label: "uses", value: formatNumber(value.uses) },
    { key: "sessions", label: "sessions", value: formatNumber(value.sessions) },
    {
      key: "injected",
      label: "tokens/use",
      value:
        value.medianContentTokens != null ? `~${formatNumber(value.medianContentTokens)}` : "—",
    },
  ];
});

const lastUsed = computed(() =>
  usage.value?.lastUsed ? formatRelativeTime(usage.value.lastUsed) : null,
);

const idleText = computed(() => (isMissing.value ? "Not installed here" : "No uses in this range"));

function navigateToEditor() {
  if (isMissing.value || !skill.value) return;
  pushRoute(router, ROUTE_NAMES.skillEditor, { params: { name: skill.value.directory } });
}

function onToggle() {
  if (!skill.value) return;
  emit("toggleEnabled", skill.value.directory, !skill.value.enabled);
}

function onDelete() {
  if (isBuiltin.value || !skill.value) return;
  emit("delete", skill.value.directory);
}

function formatTokens(tokens: number): string {
  return `~${formatNumber(tokens)}`;
}
</script>

<template>
  <DefinitionCard
    class="skill-card"
    :class="{ 'skill-card--static': isMissing }"
    :name="entry.name"
    :description="entry.description"
    :open-label="`Open skill ${entry.name}`"
    :interactive="!isMissing"
    :muted="!isMissing && !entry.enabled"
    @open="navigateToEditor"
  >
    <template #icon>
      <Search v-if="isMissing" :size="18" :stroke-width="1.75" />
      <FolderGit2 v-else-if="entry.scope === 'repository'" :size="18" :stroke-width="1.75" />
      <Package v-else-if="entry.scope === 'builtin'" :size="18" :stroke-width="1.75" />
      <Sparkles v-else :size="18" :stroke-width="1.75" />
    </template>

    <template #badges>
      <Badge :variant="badge.tone">{{ badge.label }}</Badge>
      <span v-if="skill && skill.assetCount > 0" class="badge-xs badge-files">
        {{ skill.assetCount }} file{{ skill.assetCount === 1 ? "" : "s" }}
      </span>
      <Tooltip v-if="skill" :text="SKILL_TOKEN_ESTIMATE_TOOLTIP" position="bottom">
        <span class="badge-xs badge-tokens skill-card__token-estimate" tabindex="0">
          Listing {{ formatTokens(skill.frontmatterTokens) }} · On use +{{ formatTokens(skill.instructionTokens) }}
        </span>
      </Tooltip>
      <Tooltip
        v-for="flag in badgeFlags"
        :key="flag"
        :text="SKILL_FLAG_BADGES[flag].title"
        position="bottom"
      >
        <Badge :variant="SKILL_FLAG_BADGES[flag].tone">{{ SKILL_FLAG_BADGES[flag].label }}</Badge>
      </Tooltip>
    </template>

    <template #footer>
      <p v-if="skill?.scope === 'repository'" class="skill-card__project" :title="skill.directory">
        {{ skill.directory }}
      </p>
      <UsageCardSummary
        :stats="stats" :values="sparkValues" :label="`Daily uses for ${entry.name}`"
        :last-used="lastUsed" :idle-text="idleText"
      />

      <div v-if="skill" class="skill-card__actions">
        <label class="toggle-switch">
          <input
            type="checkbox"
            :checked="skill.enabled"
            :disabled="skill.disabledReason === 'repository'"
            :aria-label="`Enable skill ${entry.name}`"
            :title="enablementTooltip"
            @change="onToggle"
          />
          <span class="toggle-track" />
          <span class="toggle-label" :title="enablementTooltip">{{ skill.enabled ? "Enabled" : "Disabled" }}</span>
        </label>

        <div class="card-hover-actions">
          <button type="button" class="action-btn" :title="isBuiltin ? 'View skill' : 'Edit skill'" :aria-label="`${isBuiltin ? 'View' : 'Edit'} skill ${entry.name}`" @click="navigateToEditor">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 13l4-1L14 4l-2-2L4 10l-1 4z" /><path d="M10 4l2 2" />
            </svg>
          </button>
          <button v-if="!isBuiltin" type="button" class="action-btn action-btn--danger" title="Remove skill" :aria-label="`Remove skill ${entry.name}`" @click="onDelete">
            <svg viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 1.25V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.67l.83 9.41A1.75 1.75 0 006 15.5h4a1.75 1.75 0 001.75-1.59l.83-9.41h.67a.75.75 0 000-1.5H11z" />
            </svg>
          </button>
        </div>
      </div>

      <p v-else class="skill-card__missing-path" :title="entry.lastKnownPath || undefined">
        <span class="skill-card__missing-label">Last loaded from</span>
        <span class="skill-card__missing-value">{{ missingHint }}</span>
      </p>
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
  font-family: var(--font-mono);
  font-size: 0.5625rem;
}

.skill-card__project {
  margin: 0 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.6875rem;
  color: var(--text-secondary);
}

/* ── Usage line ──────────────────────────────────────────── */
.skill-card__missing-path {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 8px 0 0;
  min-height: 29px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.skill-card__missing-label {
  flex-shrink: 0;
}

/* The shortened path still needs a stop, for a deeply nested leaf name. */
.skill-card__missing-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

/* ── Card actions (toggle + hover buttons) ───────────────── */
.skill-card__actions {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
  z-index: 1;
}

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
  background: var(--danger-subtle);
  border-color: var(--danger-muted, var(--border-default));
}

@media (prefers-reduced-motion: reduce) {
  .card-hover-actions,
  .toggle-track,
  .toggle-track::after {
    transition: none;
  }
}
</style>
