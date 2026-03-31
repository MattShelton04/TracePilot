<script setup lang="ts">
import type { SkillSummary } from "@tracepilot/types";
import { useRouter } from "vue-router";
import SkillScopeBadge from "./SkillScopeBadge.vue";

const props = defineProps<{
  skill: SkillSummary;
}>();

const emit = defineEmits<{
  toggleEnabled: [dir: string, enabled: boolean];
  delete: [dir: string];
}>();

const router = useRouter();

function navigateToEditor() {
  router.push({
    name: "skill-editor",
    params: { name: encodeURIComponent(props.skill.directory) },
  });
}

function onToggle(event: Event) {
  event.stopPropagation();
  emit("toggleEnabled", props.skill.directory, !props.skill.enabled);
}

function onEdit(event: Event) {
  event.stopPropagation();
  navigateToEditor();
}

function onDelete(event: Event) {
  event.stopPropagation();
  emit("delete", props.skill.directory);
}

function formatTokens(n: number): string {
  if (n >= 1_000) return `~${(n / 1_000).toFixed(1)}k tok`;
  return `~${n} tok`;
}
</script>

<template>
  <div
    class="skill-card"
    :class="{ 'skill-card--disabled': !skill.enabled }"
    tabindex="0"
    role="button"
    @click="navigateToEditor"
    @keydown.enter="navigateToEditor"
  >
    <!-- Accent top line (visible on hover) -->
    <div class="skill-card__accent" />

    <div class="skill-card__top">
      <div class="skill-card__icon">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="17" height="17">
          <path d="M9 1L5 9h4l-2 6 6-8H9l2-6z"/>
        </svg>
      </div>
      <div class="skill-card__info">
        <div class="skill-card__name-row">
          <span class="skill-card__name">{{ skill.name }}</span>
        </div>
        <p class="skill-card__desc">{{ skill.description || "No description" }}</p>
      </div>
    </div>

    <div class="skill-card__badges">
      <SkillScopeBadge :scope="skill.scope" />
      <span v-if="skill.assetCount > 0" class="badge-xs badge-files">
        {{ skill.assetCount }} file{{ skill.assetCount === 1 ? "" : "s" }}
      </span>
      <span class="badge-xs badge-tokens">{{ formatTokens(skill.estimatedTokens) }}</span>
    </div>

    <div class="skill-card__actions">
      <label class="toggle-switch" @click.stop>
        <input
          type="checkbox"
          :checked="skill.enabled"
          @change="onToggle($event)"
        />
        <span class="toggle-track" />
        <span class="toggle-label">{{ skill.enabled ? "Enabled" : "Disabled" }}</span>
      </label>

      <div class="card-hover-actions">
        <button class="action-btn" title="Edit skill" @click="onEdit($event)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 13l4-1L14 4l-2-2L4 10l-1 4z" /><path d="M10 4l2 2" />
          </svg>
        </button>
        <button class="action-btn action-btn--danger" title="Remove skill" @click="onDelete($event)">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 1.25V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.67l.83 9.41A1.75 1.75 0 006 15.5h4a1.75 1.75 0 001.75-1.59l.83-9.41h.67a.75.75 0 000-1.5H11z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Card Container ─────────────────────────────────────── */
.skill-card {
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.2s ease;
}

.skill-card:hover {
  border-color: var(--border-accent, var(--accent-fg));
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.skill-card:hover .skill-card__accent {
  opacity: 1;
}

.skill-card:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

.skill-card--disabled {
  opacity: 0.55;
}

.skill-card--disabled:hover {
  transform: none;
  box-shadow: none;
  border-color: var(--border-default);
}

.skill-card--disabled .skill-card__accent {
  display: none;
}

/* Accent top bar */
.skill-card__accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--gradient-accent, var(--accent-emphasis));
  opacity: 0;
  transition: opacity 0.2s ease;
}

/* ── Card Top (icon + info) ─────────────────────────────── */
.skill-card__top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.skill-card__icon {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  background: var(--canvas-default, var(--canvas-subtle));
  color: var(--accent-fg);
  transition: all 0.2s ease;
  font-size: 17px;
}

.skill-card:hover .skill-card__icon {
  border-color: var(--border-accent, var(--accent-fg));
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.08);
}

.skill-card__icon svg {
  width: 17px;
  height: 17px;
}

.skill-card__info {
  flex: 1;
  min-width: 0;
}

.skill-card__name-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 2px;
}

.skill-card__name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color var(--transition-fast);
}

.skill-card:hover .skill-card__name {
  color: var(--accent-fg);
}

.skill-card__desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  line-height: 1.45;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── Badges ─────────────────────────────────────────────── */
.skill-card__badges {
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

/* ── Card Actions (toggle + hover buttons) ──────────────── */
.skill-card__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  border-top: 1px solid var(--border-subtle, var(--border-muted));
  padding-top: 10px;
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

.skill-card:hover .card-hover-actions {
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

/* ── Stagger animation ──────────────────────────────────── */
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

.skill-card {
  animation: card-in 0.35s ease backwards;
}
</style>
