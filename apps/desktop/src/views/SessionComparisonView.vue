<script setup lang="ts">
import { PageShell } from "@tracepilot/ui";
import { onMounted, provide, watch } from "vue";
import { type LocationQuery, useRoute, useRouter } from "vue-router";
import ComparisonCharts from "@/components/sessionComparison/ComparisonCharts.vue";
import ComparisonHeader from "@/components/sessionComparison/ComparisonHeader.vue";
import ComparisonMetrics from "@/components/sessionComparison/ComparisonMetrics.vue";
import { SessionComparisonKey, useSessionComparison } from "@/composables/useSessionComparison";
import { ROUTE_NAMES } from "@/config/routes";
import "@/styles/features/session-comparison.css";

const comp = useSessionComparison();

provide(SessionComparisonKey, comp);

// Both picks live in the URL (`?a=…&b=…`), so Back, Forward and a shared
// link bring the comparison back.
const route = useRoute();
const router = useRouter();

function picksFrom(query: LocationQuery): { a: string; b: string } {
  const id = (value: unknown) => (typeof value === "string" ? value : "");
  return { a: id(query.a), b: id(query.b) };
}

// Leaving the page changes the route before this view unmounts.
const onComparePage = () => route.name === ROUTE_NAMES.compare;

function writePicks(a: string, b: string) {
  const current = picksFrom(route.query);
  if (current.a === a && current.b === b) return;
  const query = { ...route.query, a: a || undefined, b: b || undefined };
  void router.replace({ query });
}

function applyRoute() {
  if (!onComparePage()) return;
  const { a, b } = picksFrom(route.query);
  if (a === comp.selectedA && b === comp.selectedB) return;
  // An address without picks (the sidebar's Compare link) keeps the current
  // picks; only an address naming other sessions replaces them.
  if (!a && !b) {
    writePicks(comp.selectedA, comp.selectedB);
    return;
  }
  comp.selectedA = a;
  comp.selectedB = b;
  if (a && b && a !== b) void comp.runComparison();
}

onMounted(applyRoute);
watch(() => route.query, applyRoute);

watch(
  () => [comp.selectedA, comp.selectedB] as const,
  ([a, b]) => {
    if (onComparePage()) writePicks(a, b);
  },
);
</script>

<template>
  <PageShell>
    <div class="session-comparison-feature">
      <ComparisonHeader />

      <template v-if="comp.compared">
        <ComparisonMetrics />
        <ComparisonCharts />
      </template>
    </div>
  </PageShell>
</template>
