<script setup lang="ts">
import { useSdkSteeringContext } from "@/composables/useSdkSteering";

const ctx = useSdkSteeringContext();
</script>

<template>
  <!-- Linking in progress -->
  <div v-if="ctx.resuming" class="cb-link-prompt">
    <div class="cb-link-info">
      <svg class="cb-spin" viewBox="0 0 16 16" width="14" height="14">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" />
      </svg>
      <span>Linking session…</span>
    </div>
  </div>

  <!-- Not-linked state: show link prompt with optional model picker -->
  <div v-else class="cb-link-prompt">
    <div class="cb-link-info">
      <div class="cb-link-title">
        {{ ctx.hasActiveSdkHandle ? 'Steering Paused' : 'Link for Steering' }}
      </div>
      <div class="cb-link-desc">
        {{ ctx.hasActiveSdkHandle
          ? 'This session is already linked in the SDK bridge. Resume steering without starting another SDK process.'
          : ctx.sdk.connectionMode === 'tcp'
            ? 'Attach to this session on the shared server. You can steer alongside the terminal CLI.'
            : 'This spawns a separate CLI subprocess. For simultaneous terminal use, connect via --ui-server (TCP mode) in Settings instead.' }}
      </div>
    </div>
    <div class="cb-link-actions">
      <div class="cb-prelink-model">
        <button
          class="cb-model-pick-btn"
          :class="{ active: ctx.showModelPicker }"
          title="Choose a model for this session"
          @click.stop="ctx.toggleModelPicker"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
            <path d="M8 1a2.5 2.5 0 00-2.5 2.5v.382a5.522 5.522 0 00-1.293.749l-.331-.191A2.5 2.5 0 00.58 6.56l.5.866a2.5 2.5 0 002.297 1.12l.331-.192a5.56 5.56 0 000 1.291l-.331.192a2.5 2.5 0 00-2.296 1.12l-.5.867a2.5 2.5 0 003.296 2.12l.331-.192c.39.305.826.56 1.293.749v.382a2.5 2.5 0 005 0v-.382a5.52 5.52 0 001.293-.749l.331.192a2.5 2.5 0 003.296-2.12l-.5-.867a2.5 2.5 0 00-2.296-1.12l-.331.192a5.56 5.56 0 000-1.291l.331-.192a2.5 2.5 0 002.296-1.12l.5-.866A2.5 2.5 0 0012.124 4.44l-.331.191A5.52 5.52 0 0010.5 3.882V3.5A2.5 2.5 0 008 1zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/>
          </svg>
          <span class="cb-model-pick-label">{{ ctx.pendingModel ?? 'default model' }}</span>
          <svg viewBox="0 0 12 12" width="10" height="10" :class="{ flip: ctx.showModelPicker }">
            <path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <Teleport to="body">
          <div
            v-if="ctx.showModelPicker"
            class="cb-model-dropdown-portal"
            :style="ctx.modelPickerStyle"
          >
            <button
              :class="['cb-model-option', { active: !ctx.pendingModel }]"
              @click.stop="ctx.selectPendingModel(null)"
            >
              <span>Default (session's current model)</span>
              <span class="cb-check">✓</span>
            </button>
            <button
              v-for="m in ctx.sdk.models"
              :key="m.id"
              :class="['cb-model-option', { active: ctx.pendingModel === m.id }]"
              @click.stop="ctx.selectPendingModel(m.id)"
            >
              <span>{{ m.name ?? m.id }}</span>
              <span class="cb-check">✓</span>
            </button>
            <div v-if="ctx.sdk.models.length === 0" class="cb-model-empty">
              Connect SDK to see available models
            </div>
          </div>
        </Teleport>
      </div>

      <button class="cb-btn-link" :disabled="ctx.resuming" @click="ctx.linkSession">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M10 2h4v4" /><path d="M14 2L8 8" /><path d="M12 9v4a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1h4" />
        </svg>
        {{ ctx.hasActiveSdkHandle ? 'Resume Steering' : 'Link Session' }}
      </button>
    </div>
  </div>
</template>
