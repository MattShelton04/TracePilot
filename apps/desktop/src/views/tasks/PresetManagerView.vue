<script setup lang="ts">
import { PageHeader, PageShell } from "@tracepilot/ui";
import { onMounted } from "vue";
import PresetDetailSlideover from "@/components/tasks/PresetDetailSlideover.vue";
import DeletePresetConfirm from "@/components/tasks/presets/DeletePresetConfirm.vue";
import EditPresetModal from "@/components/tasks/presets/EditPresetModal.vue";
import NewPresetModal from "@/components/tasks/presets/NewPresetModal.vue";
import PresetFilterBar from "@/components/tasks/presets/PresetFilterBar.vue";
import PresetGrid from "@/components/tasks/presets/PresetGrid.vue";
import PresetList from "@/components/tasks/presets/PresetList.vue";
import PresetStatsStrip from "@/components/tasks/presets/PresetStatsStrip.vue";
import { usePresetManager } from "@/composables/usePresetManager";
import "@/styles/features/preset-manager.css";

const mgr = usePresetManager();
const store = mgr.store;

onMounted(() => {
  store.loadPresets();
});
</script>

<template>
  <PageShell>
    <div class="preset-manager">
      <PageHeader title="Task Presets" class="preset-manager-header">
        <template #icon>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            width="16"
            height="16"
          >
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <path d="M5 6h6M5 8.5h4M5 11h2" />
          </svg>
        </template>
        <template #actions>
          <button class="btn btn--primary" @click="mgr.openNewPresetModal()">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              width="14"
              height="14"
            >
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
            New Preset
          </button>
        </template>
      </PageHeader>

      <PresetStatsStrip
        :total="store.presets.length"
        :builtin="store.builtinPresets.length"
        :custom="store.customPresets.length"
        :enabled="store.enabledPresets.length"
      />

      <PresetFilterBar
        :search-query="store.searchQuery"
        :filter-tag="store.filterTag"
        :all-tags="store.allTags"
        :sort-by="mgr.sortBy"
        :view-mode="mgr.viewMode"
        :category-filter="mgr.categoryFilter"
        @update:search-query="(v) => store.setSearchQuery(v)"
        @update:filter-tag="(v) => store.setFilterTag(v)"
        @update:sort-by="(v) => (mgr.sortBy = v)"
        @update:view-mode="(v) => (mgr.viewMode = v)"
        @update:category-filter="(v) => (mgr.categoryFilter = v)"
      />

      <div v-if="store.loading" class="state-message">Loading presets…</div>
      <div v-else-if="store.error" class="state-message state-message--error">
        {{ store.error }}
        <button class="btn btn--secondary btn--sm" @click="store.loadPresets()">
          Retry
        </button>
      </div>

      <template v-else-if="mgr.displayPresets.length > 0">
        <PresetGrid
          v-if="mgr.viewMode === 'grid'"
          :presets="mgr.displayPresets"
          :context-source-count="mgr.contextSourceCount"
          :variable-count="mgr.variableCount"
          :truncate="mgr.truncate"
          :display-tags="mgr.displayTags"
          :task-type-color-class="mgr.taskTypeColorClass"
          :info-line="mgr.infoLine"
          @open-detail="mgr.openDetail"
          @toggle="mgr.togglePreset"
          @run="mgr.runTask"
          @duplicate="mgr.duplicatePreset"
          @edit="mgr.openEditModal"
          @delete="mgr.confirmDelete"
        />
        <PresetList
          v-else
          :presets="mgr.displayPresets"
          :context-source-count="mgr.contextSourceCount"
          :display-tags="mgr.displayTags"
          :task-type-color-class="mgr.taskTypeColorClass"
          @open-detail="mgr.openDetail"
          @toggle="mgr.togglePreset"
          @run="mgr.runTask"
          @edit="mgr.openEditModal"
          @delete="mgr.confirmDelete"
        />
      </template>

      <div v-else-if="!store.loading && !store.error" class="empty-state">
        <div class="empty-state__icon">📋</div>
        <h3 class="empty-state__title">No presets found</h3>
        <p class="empty-state__desc">
          {{
            store.searchQuery || store.filterTag !== "all" || mgr.categoryFilter !== "all"
              ? "Try a different search term, tag, or category filter"
              : "No presets configured. Create your first preset to get started."
          }}
        </p>
        <div class="empty-state__actions">
          <button class="btn btn--primary" @click="mgr.openNewPresetModal()">
            Create Preset
          </button>
        </div>
      </div>
    </div>

    <DeletePresetConfirm
      :open="mgr.showDeleteConfirm"
      :preset="mgr.presetToDelete"
      @confirm="mgr.handleDelete"
      @cancel="mgr.cancelDelete"
    />

    <NewPresetModal
      :open="mgr.showNewPresetModal"
      @update:open="(v) => (mgr.showNewPresetModal = v)"
    />

    <EditPresetModal
      :open="mgr.showEditModal"
      :preset="mgr.editingPreset"
      :saving="mgr.saving"
      @save="mgr.handleSaveEdit"
      @cancel="mgr.closeEditModal"
    />

    <PresetDetailSlideover
      :visible="mgr.showDetail"
      :preset="mgr.detailPreset"
      @close="mgr.closeDetail"
      @run="mgr.runTask"
      @duplicate="mgr.duplicatePreset"
      @edit="(p) => { mgr.openEditModal(p); mgr.closeDetail(); }"
      @delete="(p) => { mgr.confirmDelete(p); mgr.closeDetail(); }"
    />
  </PageShell>
</template>
