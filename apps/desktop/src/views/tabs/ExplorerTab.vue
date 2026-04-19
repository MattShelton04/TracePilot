<script setup lang="ts">
import type { SessionFileType } from "@tracepilot/types";
import { FileBrowserTree, FileContentViewer } from "@tracepilot/ui";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSessionFiles } from "@/composables/useSessionFiles";

const store = useSessionDetailContext();

const sessionFiles = useSessionFiles(() => store.sessionId);

async function onViewFile(path: string) {
  // Find the fileType from the entries list
  const entry = sessionFiles.files.find((f) => f.path === path);
  const fileType: SessionFileType = entry?.fileType ?? "text";
  await sessionFiles.selectFile(path, fileType);
}
</script>

<template>
  <div class="explorer-tab">
    <div class="explorer-tab__tree">
      <FileBrowserTree
        :entries="sessionFiles.files"
        :loading="sessionFiles.filesLoading"
        :selected-path="sessionFiles.selectedPath ?? undefined"
        title="Session Files"
        @view-file="onViewFile"
      />
    </div>

    <div class="explorer-tab__viewer">
      <FileContentViewer
        :file-path="sessionFiles.selectedPath ?? undefined"
        :content="sessionFiles.fileContent ?? undefined"
        :file-type="sessionFiles.selectedFileType ?? undefined"
        :loading="sessionFiles.fileContentLoading"
        :error="sessionFiles.fileContentError"
      />
    </div>
  </div>
</template>

<style scoped>
.explorer-tab {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.explorer-tab__tree {
  width: 240px;
  min-width: 160px;
  max-width: 360px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-default);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.explorer-tab__viewer {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
