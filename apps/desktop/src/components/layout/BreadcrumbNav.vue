<!--
  Thin wrapper around `BreadcrumbNav` from `@tracepilot/ui`, kept so that
  existing in-app callers (App.vue chrome row) and tests can continue to
  use the `items` prop name. The canonical implementation, design tokens,
  truncation, tooltip, and aria semantics live in
  packages/ui/src/components/BreadcrumbNav.vue.
-->
<script setup lang="ts">
import { type BreadcrumbItem, BreadcrumbNav } from "@tracepilot/ui";

interface Props {
  items: BreadcrumbItem[];
}

defineProps<Props>();
</script>

<template>
  <BreadcrumbNav :crumbs="items" />
</template>
