<script setup lang="ts">
import { useSessionLauncherContext } from "@/composables/useSessionLauncher";

const {
  store,
  selectedTemplateId,
  confirmingDeleteId,
  hasDismissedDefaults,
  applyTemplate,
  openContextMenu,
  moveTemplate,
  deleteTemplateInline,
  cancelDeleteInline,
  templateIcon,
  templateDisplayName,
} = useSessionLauncherContext();
</script>

<template>
  <section
    v-if="store.loading || store.templates.length || hasDismissedDefaults"
    class="section-block"
  >
    <div class="section-header-row">
      <h2 class="section-label">Saved Templates</h2>
      <button
        v-if="hasDismissedDefaults"
        class="tpl-restore-btn"
        title="Restore dismissed default templates"
        @click="store.restoreDefaults()"
      >
        ↻ Restore Defaults
      </button>
    </div>
    <div v-if="store.loading && !store.templates.length" class="tpl-grid">
      <div v-for="n in 3" :key="n" class="tpl-card tpl-skeleton">
        <span class="tpl-emoji">⏳</span>
        <span class="tpl-name skeleton-text">&nbsp;</span>
        <span class="tpl-desc skeleton-text">&nbsp;</span>
      </div>
    </div>
    <div v-else class="tpl-grid">
      <button
        v-for="(tpl, idx) in store.templates"
        :key="tpl.id"
        class="tpl-card"
        :class="{ selected: selectedTemplateId === tpl.id }"
        @click="applyTemplate(tpl.id)"
        @contextmenu="openContextMenu($event, tpl.id)"
      >
        <div class="tpl-card-actions" @click.stop>
          <button
            class="tpl-action-btn tpl-move-btn"
            :disabled="idx === 0"
            title="Move up"
            @click="moveTemplate(idx, 'up')"
          >▲</button>
          <button
            class="tpl-action-btn tpl-move-btn"
            :disabled="idx === store.templates.length - 1"
            title="Move down"
            @click="moveTemplate(idx, 'down')"
          >▼</button>
          <button
            class="tpl-action-btn tpl-delete-btn"
            title="Delete template"
            @click="deleteTemplateInline(tpl.id)"
          >×</button>
        </div>
        <Transition name="fade">
          <div v-if="confirmingDeleteId === tpl.id" class="tpl-delete-overlay" @click.stop>
            <span class="tpl-delete-overlay-text">Delete this template?</span>
            <div class="tpl-delete-overlay-actions">
              <button class="tpl-confirm-yes" @click="deleteTemplateInline(tpl.id)">Delete</button>
              <button class="tpl-confirm-cancel" @click="cancelDeleteInline">Cancel</button>
            </div>
          </div>
        </Transition>
        <span class="tpl-emoji">{{ templateIcon(tpl) }}</span>
        <span class="tpl-name">{{ templateDisplayName(tpl.name) }}</span>
        <span v-if="tpl.description" class="tpl-desc">{{ tpl.description }}</span>
        <span class="tpl-stats">Used {{ tpl.usageCount }} times</span>
      </button>
    </div>
  </section>
</template>
