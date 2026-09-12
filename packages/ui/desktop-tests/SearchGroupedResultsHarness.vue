<script setup lang="ts">
import { defineComponent, getCurrentInstance, h, ref } from "vue";
import SearchGroupedResults from "../../../apps/desktop/src/components/search/SearchGroupedResults.vue";
import type { SessionGroup } from "../../../apps/desktop/src/stores/search";
import "../../../apps/desktop/src/styles/components.css";

defineProps<{ width: number }>();

// Link geometry and native focus use an anchor; routing is covered separately.
getCurrentInstance()?.appContext.app.component(
  "RouterLink",
  defineComponent({
    props: { to: { type: String, required: true } },
    setup:
      (props, { slots }) =>
      () =>
        h("a", { href: props.to }, slots.default?.()),
  }),
);

const summary =
  "Audit session with a long descriptive title covering keyboard navigation, Unicode café and readable search results across desktop widths";
const groups: SessionGroup[] = [
  {
    sessionId: "audit-group",
    sessionSummary: summary,
    sessionRepository: `audit/${"longrepository".repeat(6)}`,
    sessionBranch: `feature/${"longbranch".repeat(6)}`,
    results: [
      {
        id: 1,
        sessionId: "audit-group",
        sessionSummary: summary,
        sessionRepository: null,
        sessionBranch: null,
        sessionUpdatedAt: null,
        contentType: "user_message",
        snippet: "Keyboard result",
        turnNumber: 1,
        eventIndex: 1,
        toolName: null,
        timestampUnix: null,
        metadataJson: null,
      },
    ],
  },
];
const collapsed = ref(new Set<string>());
const filters = ref(0);
function toggle(id: string) {
  collapsed.value = collapsed.value.has(id) ? new Set() : new Set([id]);
}
</script>

<template>
  <div :style="{ width: `${width}px` }">
    <SearchGroupedResults
      :grouped-results="groups"
      :collapsed-groups="collapsed"
      :expanded-results="new Set()"
      :result-index-map="new Map([[1, 0]])"
      :focused-result-index="null"
      :has-more="false"
      :content-type-config="{}"
      :session-link="() => '/session/audit-group/conversation'"
      @toggle-group-collapse="toggle"
      @filter-by-session="filters++"
    />
    <output aria-label="Filter count">{{ filters }}</output>
  </div>
</template>
