<script setup lang="ts">
import type { McpServerConfig } from "@tracepilot/types";
import AddServerAdvanced from "./addServer/AddServerAdvanced.vue";
import AddServerBasicFields from "./addServer/AddServerBasicFields.vue";
import AddServerEnvPairs from "./addServer/AddServerEnvPairs.vue";
import AddServerJsonPreview from "./addServer/AddServerJsonPreview.vue";
import { useAddServerForm } from "./addServer/useAddServerForm";

const emit = defineEmits<{
  close: [];
  submit: [name: string, config: McpServerConfig];
}>();

const {
  form,
  submitting,
  validationError,
  showAdvanced,
  jsonPreview,
  addEnvPair,
  removeEnvPair,
  handleSubmit,
} = useAddServerForm((name, config) => emit("submit", name, config));
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="add-modal" role="dialog" aria-labelledby="add-server-title">
        <div class="modal-header-wrap">
          <div class="modal-title-row">
            <div class="modal-title">
              <div class="modal-title-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
              </div>
              <span id="add-server-title">Add MCP Server</span>
            </div>
            <button class="modal-close" aria-label="Close" @click="emit('close')"><span aria-hidden="true">✕</span></button>
          </div>
        </div>

        <div class="modal-body-area">
          <div class="custom-layout">
            <div class="custom-form-col">
              <form @submit.prevent="handleSubmit">
                <AddServerBasicFields :form="form" />

                <div class="form-divider" />

                <AddServerEnvPairs
                  :form="form"
                  @add-pair="addEnvPair"
                  @remove-pair="removeEnvPair"
                />

                <AddServerAdvanced
                  :form="form"
                  :show-advanced="showAdvanced"
                  @update:show-advanced="showAdvanced = $event"
                />

                <p v-if="validationError" class="validation-error">{{ validationError }}</p>
              </form>
            </div>

            <AddServerJsonPreview :json-preview="jsonPreview" />
          </div>
        </div>

        <div class="modal-footer-bar">
          <button class="btn-cancel" type="button" @click="emit('close')">Cancel</button>
          <button class="btn-add" type="button" :disabled="submitting" @click="handleSubmit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            {{ submitting ? "Adding…" : "Add Server" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style src="./addServer/add-server.css"></style>
