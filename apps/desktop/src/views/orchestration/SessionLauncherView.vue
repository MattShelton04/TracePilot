<script setup lang="ts">
import { ErrorAlert, PageHeader } from "@tracepilot/ui";
import { provide } from "vue";
import SessionLauncherAdvanced from "@/components/sessionLauncher/SessionLauncherAdvanced.vue";
import SessionLauncherConfig from "@/components/sessionLauncher/SessionLauncherConfig.vue";
import SessionLauncherPreview from "@/components/sessionLauncher/SessionLauncherPreview.vue";
import SessionLauncherPrompt from "@/components/sessionLauncher/SessionLauncherPrompt.vue";
import SessionLauncherSaveTemplate from "@/components/sessionLauncher/SessionLauncherSaveTemplate.vue";
import SessionLauncherTemplates from "@/components/sessionLauncher/SessionLauncherTemplates.vue";
import { SessionLauncherKey, useSessionLauncher } from "@/composables/useSessionLauncher";
import "@/styles/features/session-launcher.css";

const ctx = useSessionLauncher();
provide(SessionLauncherKey, ctx);
const { store, contextMenuTpl, deleteContextTemplate, closeContextMenu } = ctx;
</script>

<template>
  <div class="session-launcher-feature">
    <div class="store-shell" @click="closeContextMenu">
      <Teleport to="body">
        <div
          v-if="contextMenuTpl"
          class="session-launcher-ctx-menu"
          :style="{ left: contextMenuTpl.x + 'px', top: contextMenuTpl.y + 'px' }"
          @click.stop
        >
          <button class="ctx-item ctx-danger" @click="deleteContextTemplate">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM4.997 6.178a.75.75 0 1 0-1.493.144l.684 7.084A1.75 1.75 0 0 0 5.926 15h4.148a1.75 1.75 0 0 0 1.738-1.594l.684-7.084a.75.75 0 1 0-1.493-.144L10.32 13.26a.25.25 0 0 1-.249.24H5.926a.25.25 0 0 1-.248-.227L4.997 6.178Z"/></svg>
            Delete Template
          </button>
        </div>
      </Teleport>

      <div class="split-layout">
        <main class="panel-left">
          <PageHeader
            title="Launch Session"
            subtitle="Configure and launch a new Copilot CLI session"
            size="sm"
            class="session-launcher-header"
          />

          <div v-if="store && !store.isReady && !store.loading" class="readiness-banner">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="readiness-icon">
              <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"/>
            </svg>
            <span>
              System not ready —
              <template v-if="store.systemDeps">
                <strong v-if="!store.systemDeps.gitAvailable">git</strong>
                <template v-if="!store.systemDeps.gitAvailable && !store.systemDeps.copilotAvailable"> and </template>
                <strong v-if="!store.systemDeps.copilotAvailable">GitHub Copilot CLI</strong>
                not found on PATH.
              </template>
              <template v-else>ensure <strong>git</strong> and <strong>GitHub Copilot CLI</strong> are installed.</template>
            </span>
          </div>

          <ErrorAlert v-if="store.error" :message="store.error" variant="banner" dismissible @dismiss="store.clearError()" />

          <SessionLauncherTemplates />
          <SessionLauncherConfig />
          <SessionLauncherPrompt />
          <SessionLauncherAdvanced />
          <SessionLauncherSaveTemplate />
        </main>

        <SessionLauncherPreview />
      </div>
    </div>
  </div>
</template>
