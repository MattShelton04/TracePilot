<script setup lang="ts">
import { Save } from "lucide-vue-next";
import { useSessionLauncherContext } from "@/composables/useSessionLauncher";

const { showTemplateForm, templateForm, handleSaveTemplate } = useSessionLauncherContext();
</script>

<template>
  <section class="section-block">
    <label class="tpl-save-toggle">
      <input type="checkbox" v-model="showTemplateForm" class="tpl-save-checkbox" />
      <span class="tpl-save-toggle-label">
        <Save :size="14" :stroke-width="1.5" aria-hidden="true" />
        Save as Template
      </span>
    </label>
    <Transition name="slide">
      <div v-if="showTemplateForm" class="section-panel tpl-save-form">
        <div class="form-grid-2col">
          <div class="form-group">
            <label class="form-label">Template Name <span class="required">*</span></label>
            <input v-model="templateForm.name" type="text" class="form-input" placeholder="My Template" />
          </div>
          <div class="form-group">
            <label class="form-label">Category</label>
            <input v-model="templateForm.category" type="text" class="form-input" placeholder="e.g. frontend" />
          </div>
        </div>
        <div class="form-grid-2col">
          <div class="form-group">
            <label class="form-label">Description</label>
            <input v-model="templateForm.description" type="text" class="form-input" placeholder="Quick description of this template" />
          </div>
          <div class="form-group">
            <label class="form-label">Icon</label>
            <input v-model="templateForm.icon" type="text" class="form-input tpl-icon-input" placeholder="Optional emoji" maxlength="14" />
            <span class="form-hint">Emoji shown on the template card</span>
          </div>
        </div>
        <button
          class="btn btn-primary"
          style="margin-top: 10px"
          :disabled="!templateForm.name.trim()"
          @click="handleSaveTemplate"
        >Save Template</button>
        <p class="form-hint" style="margin-top: 6px">If a template with the same name exists, you'll be prompted to overwrite it.</p>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.tpl-save-toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
