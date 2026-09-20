<script setup lang="ts">
import { formatNumberFull } from "@tracepilot/types";
import { MarkdownContent, TabNav, type TabNavItem, Tooltip } from "@tracepilot/ui";
import { computed } from "vue";
import SkillUsageTab from "@/components/skillEditor/SkillUsageTab.vue";
import SkillAssetsTree from "@/components/skills/SkillAssetsTree.vue";
import SkillScopeBadge from "@/components/skills/SkillScopeBadge.vue";
import { SKILL_TOKEN_ESTIMATE_TOOLTIP } from "@/components/skills/tokenEstimate";
import { useSkillEditorContext } from "@/composables/useSkillEditor";
import { openExternal } from "@/utils/openExternal";

const ctx = useSkillEditorContext();

// TabNav keys the active tab off `routeName` in local (v-model) mode too.
const tabs = computed<TabNavItem[]>(() => [
  { name: "preview", routeName: "preview", label: "Preview" },
  {
    name: "usage",
    routeName: "usage",
    label: "Usage",
    count: ctx.usage?.stats.uses || undefined,
  },
]);
</script>

<template>
  <div class="panel panel-right">
    <div class="panel-header panel-header--tabs">
      <TabNav
        :tabs="tabs"
        :model-value="ctx.activeTab"
        aria-label="Skill detail"
        @update:model-value="ctx.activeTab = $event as typeof ctx.activeTab"
      />
    </div>

    <div class="panel-scroll" :class="{ 'panel-scroll--usage': ctx.activeTab === 'usage' }">
      <template v-if="ctx.activeTab === 'preview'">
        <div class="preview-content">
          <!-- Preview Frontmatter Card -->
          <div v-if="ctx.previewFrontmatter" class="preview-frontmatter">
            <div class="preview-skill-name">
              <span class="name-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 4v4l3 2"/></svg>
              </span>
              {{ ctx.previewFrontmatter.name || 'Untitled Skill' }}
            </div>
            <div v-if="ctx.previewFrontmatter.description" class="preview-skill-desc">
              {{ ctx.previewFrontmatter.description }}
            </div>
            <div class="preview-skill-meta">
              <SkillScopeBadge :scope="ctx.store.selectedSkill!.scope" />
              <Tooltip :text="SKILL_TOKEN_ESTIMATE_TOOLTIP" position="bottom">
                <span class="badge badge-neutral" tabindex="0">
                  ~{{ formatNumberFull(ctx.tokenUsage.frontmatterTokens) }} listing ·
                  +~{{ formatNumberFull(ctx.tokenUsage.instructionTokens) }} on use
                </span>
              </Tooltip>
            </div>
          </div>

          <!-- Rendered Markdown -->
          <div class="preview-markdown" @click="ctx.handlePreviewClick">
            <MarkdownContent :content="ctx.previewBody" @open-external="openExternal" />
          </div>
        </div>

        <!-- Assets Section -->
        <div class="assets-section">
          <SkillAssetsTree
            :assets="ctx.assets"
            :loading="ctx.assetsLoading"
            :readonly="ctx.isReadOnly"
            @add-asset="ctx.handleAddAsset"
            @new-file="(name: string) => ctx.handleNewFile(name)"
            @remove-asset="ctx.handleRemoveAsset"
            @view-asset="ctx.handleViewAsset"
          />
        </div>
      </template>

      <SkillUsageTab v-else />
    </div>
  </div>
</template>
