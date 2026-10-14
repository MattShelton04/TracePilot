<script setup lang="ts">
/**
 * ExitPlanModeRenderer — Claude Code's plan-approval request. The submitted
 * plan (`args.plan`, Markdown) stays separate from the recorded response.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { computed } from "vue";
import { toolCallStatus } from "../../utils/toolCallStatus";
import MarkdownContent from "../MarkdownContent.vue";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc?: TurnToolCall;
}>();
const status = computed(() => toolCallStatus(props.tc));
const plan = computed(() => (typeof props.args.plan === "string" ? props.args.plan : null));
const copyText = computed(() =>
  [plan.value, props.content].filter((part): part is string => !!part).join("\n\n"),
);
</script>

<template>
  <RendererShell tool-name="Plan" icon-name="clipboard-list" :status="status" :copy-text="copyText">
    <section v-if="plan" class="plan-section" aria-label="Submitted plan">
      <RendererScrollRegion label="plan" :max-height="480">
        <MarkdownContent :content="plan" :render="true" class="plan-markdown" />
      </RendererScrollRegion>
    </section>
    <p v-else class="plan-empty">No plan text in the call's input.</p>
    <section class="plan-response" aria-label="Response">
      <span class="plan-response-label">Response</span>
      <pre v-if="content" :class="{ 'plan-response--error': status === 'error' }">{{ content }}</pre>
      <p v-else class="plan-response-note">
        {{ status === "pending" ? "Waiting for the plan to be approved…" : "No response recorded." }}
      </p>
    </section>
  </RendererShell>
</template>

<style scoped>
.plan-markdown { padding: 12px; font-size: 13px; overflow-wrap: anywhere; }
.plan-empty { margin: 0; padding: 12px; font-size: 12px; color: var(--text-secondary); }
.plan-response { padding: 12px; border-top: 1px solid var(--border-subtle); }
.plan-response-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.plan-response pre,
.plan-response-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.plan-response pre { font-family: inherit; }
.plan-response pre.plan-response--error { color: var(--danger-fg); }
</style>
