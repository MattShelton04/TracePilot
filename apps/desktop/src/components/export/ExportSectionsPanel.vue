<script setup lang="ts">
import type { ContentDetailOptions, RedactionOptions, SectionId } from "@tracepilot/types";
import { SECTION_LABELS } from "@tracepilot/types";
import { FormSwitch } from "@tracepilot/ui";
import { SECTION_GROUPS, SECTION_ICONS } from "@/composables/useExportConfig";

defineProps<{
  enabledSections: Set<SectionId>;
  contentDetail: ContentDetailOptions;
  redaction: RedactionOptions;
  sectionHasData: (sectionId: SectionId) => boolean | null;
}>();

const emit = defineEmits<{
  (e: "toggle-section", id: SectionId): void;
  (e: "select-all"): void;
  (e: "select-none"): void;
  (e: "update-content-detail", key: keyof ContentDetailOptions, value: boolean): void;
  (e: "update-redaction", key: keyof RedactionOptions, value: boolean): void;
}>();
</script>

<template>
  <div>
    <!-- Content Sections -->
    <section class="config-section">
      <div class="section-title-row">
        <h3 class="config-section-title">Content Sections</h3>
        <span class="section-actions">
          <button class="link-btn" @click="emit('select-all')">Select All</button>
          ·
          <button class="link-btn" @click="emit('select-none')">Clear</button>
        </span>
      </div>
      <div v-for="group in SECTION_GROUPS" :key="group.label">
        <div class="toggle-group-label">{{ group.label }}</div>
        <div
          v-for="sectionId in group.sections"
          :key="sectionId"
          class="toggle-row"
        >
          <span class="toggle-row-icon">{{ SECTION_ICONS[sectionId] }}</span>
          <span class="toggle-row-label">
            {{ SECTION_LABELS[sectionId] }}
            <span
              v-if="sectionHasData(sectionId) === false"
              class="no-data-hint"
            >(empty)</span>
          </span>
          <FormSwitch
            :model-value="enabledSections.has(sectionId)"
            :aria-label="`Include ${SECTION_LABELS[sectionId]} section`"
            @update:model-value="emit('toggle-section', sectionId)"
          />
        </div>
      </div>
    </section>

    <!-- Detail Level -->
    <section v-if="enabledSections.has('conversation')" class="config-section">
      <h3 class="config-section-title">Detail Level</h3>
      <div class="toggle-row">
        <span class="toggle-row-icon">🤖</span>
        <span class="toggle-row-label">
          Include subagent internals
          <span class="detail-hint">Include subagent reasoning, tool calls &amp; intermediate thoughts</span>
        </span>
        <FormSwitch
          :model-value="contentDetail.includeSubagentInternals"
          aria-label="Include subagent internals"
          @update:model-value="emit('update-content-detail', 'includeSubagentInternals', $event)"
        />
      </div>
      <div class="toggle-row">
        <span class="toggle-row-icon">🔧</span>
        <span class="toggle-row-label">
          Tool call details
          <span class="detail-hint">Include arguments &amp; result content</span>
        </span>
        <FormSwitch
          :model-value="contentDetail.includeToolDetails"
          aria-label="Include tool call details"
          @update:model-value="emit('update-content-detail', 'includeToolDetails', $event)"
        />
      </div>
      <div class="toggle-row">
        <span class="toggle-row-icon">📄</span>
        <span class="toggle-row-label">
          Full tool results
          <span class="detail-hint">Include complete output instead of 1KB preview (may be large)</span>
        </span>
        <FormSwitch
          :model-value="contentDetail.includeFullToolResults"
          aria-label="Include full tool results"
          @update:model-value="emit('update-content-detail', 'includeFullToolResults', $event)"
        />
      </div>
    </section>

    <!-- Privacy / Redaction -->
    <section class="config-section">
      <h3 class="config-section-title">Privacy</h3>
      <div class="toggle-row">
        <span class="toggle-row-icon">📁</span>
        <span class="toggle-row-label">
          Anonymize paths
          <span class="detail-hint">Replace filesystem paths with placeholders</span>
        </span>
        <FormSwitch
          :model-value="redaction.anonymizePaths"
          aria-label="Anonymize paths"
          @update:model-value="emit('update-redaction', 'anonymizePaths', $event)"
        />
      </div>
      <div class="toggle-row">
        <span class="toggle-row-icon">🔑</span>
        <span class="toggle-row-label">
          Strip secrets
          <span class="detail-hint">Remove API keys, tokens, and credentials</span>
        </span>
        <FormSwitch
          :model-value="redaction.stripSecrets"
          aria-label="Strip secrets"
          @update:model-value="emit('update-redaction', 'stripSecrets', $event)"
        />
      </div>
      <div class="toggle-row">
        <span class="toggle-row-icon">👤</span>
        <span class="toggle-row-label">
          Strip PII
          <span class="detail-hint">Remove emails, IP addresses, and other personal data</span>
        </span>
        <FormSwitch
          :model-value="redaction.stripPii"
          aria-label="Strip PII"
          @update:model-value="emit('update-redaction', 'stripPii', $event)"
        />
      </div>
    </section>
  </div>
</template>
