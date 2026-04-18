<script setup lang="ts">
import { MarkdownContent } from "@tracepilot/ui";
import SkillAssetsTree from "@/components/skills/SkillAssetsTree.vue";
import SkillScopeBadge from "@/components/skills/SkillScopeBadge.vue";
import { useSkillEditorContext } from "@/composables/useSkillEditor";
import { openExternal } from "@/utils/openExternal";

const ctx = useSkillEditorContext();
</script>

<template>
  <div class="panel panel-right">
    <div class="panel-header">
      <span class="panel-header-title">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
        Preview
      </span>
    </div>

    <div class="panel-scroll">
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
            <span class="badge badge-neutral">
              ~{{ ctx.store.selectedSkill!.estimatedTokens.toLocaleString() }} tokens
            </span>
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
          @add-asset="ctx.handleAddAsset"
          @new-file="(name: string) => ctx.handleNewFile(name)"
          @remove-asset="ctx.handleRemoveAsset"
          @view-asset="ctx.handleViewAsset"
        />
      </div>
    </div>
  </div>
</template>
