<script setup lang="ts">
import KbdHelpOverlay from "../../../apps/desktop/src/components/chrome/KbdHelpOverlay.vue";
import { useShortcut } from "../../../apps/desktop/src/composables/useShortcut";
import "../../../apps/desktop/src/styles/overlays.css";

useShortcut("Mod+Shift+A", () => {}, {
  description: "Toggle alert center",
  group: "Global",
});
</script>

<template>
  <div>
    <button type="button">Return focus here</button>
    <KbdHelpOverlay />
  </div>
</template>
