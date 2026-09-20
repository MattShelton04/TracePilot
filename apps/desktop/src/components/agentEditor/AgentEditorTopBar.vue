<script setup lang="ts">
import { ActionButton, Badge, Tooltip } from "@tracepilot/ui";
import { ChevronLeft, Save, Sliders, Trash2, X } from "lucide-vue-next";
import { scopeBadge } from "@/components/agents/agentBadges";
import { useAgentEditorContext } from "@/composables/useAgentEditor";

const ctx = useAgentEditorContext();
const emit = defineEmits<{ override: [] }>();
</script>

<template>
  <header class="editor-topbar">
    <button class="topbar-back" @click="ctx.goBack">
      <ChevronLeft :size="13" :stroke-width="1.75" />
      Back to Agents
    </button>
    <div class="topbar-divider" />
    <div class="topbar-skill-name">{{ ctx.agentName || "Agent" }}</div>
    <div class="topbar-meta">
      <Badge :variant="scopeBadge(ctx.detail?.summary.scope ?? 'unresolved').tone">
        {{ scopeBadge(ctx.detail?.summary.scope ?? "unresolved").label }}
      </Badge>
      <Badge v-if="ctx.disabled" variant="danger">Disabled</Badge>
      <Badge v-if="ctx.override" variant="accent">Overridden</Badge>
      <span v-if="ctx.dirty" class="status-modified">Modified</span>
    </div>
    <div class="topbar-actions">
      <span v-if="ctx.readOnlyReason" class="kbd-hint">{{ ctx.readOnlyReason }}</span>
      <span v-else class="kbd-hint">
        <span class="kbd">Ctrl</span>+<span class="kbd">S</span>
      </span>

      <Tooltip
        :text="
          ctx.canOverride
            ? 'Write a /subagents setting: the supported way to change a built-in, and it survives CLI updates.'
            : 'settings.json has an unexpected subagents shape, so overrides are read-only.'
        "
        position="bottom"
      >
        <ActionButton size="sm" :disabled="!ctx.canOverride" @click="emit('override')">
          <Sliders :size="13" :stroke-width="1.75" />
          Override
        </ActionButton>
      </Tooltip>

      <template v-if="!ctx.isReadOnly">
        <ActionButton size="sm" :disabled="!ctx.dirty" @click="ctx.discard">
          <X :size="13" :stroke-width="1.75" />
          Discard
        </ActionButton>
        <ActionButton
          v-if="ctx.detail?.summary.scope !== 'builtin'"
          size="sm"
          @click="ctx.remove"
        >
          <Trash2 :size="13" :stroke-width="1.75" />
          Delete
        </ActionButton>
        <ActionButton
          variant="primary"
          size="sm"
          :disabled="!ctx.canSave"
          :loading="ctx.saving"
          @click="ctx.save"
        >
          <Save :size="13" :stroke-width="1.75" />
          Save
        </ActionButton>
      </template>
    </div>
  </header>
</template>
