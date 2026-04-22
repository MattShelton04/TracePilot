<script setup lang="ts">
import {
  Badge,
  EmptyState,
  ExpandChevron,
  formatArgsSummary,
  formatDuration,
  formatLiveDuration,
  formatNumber,
  formatTime,
  MarkdownContent,
  STATUS_ICONS,
  ToolArgsRenderer,
  ToolResultRenderer,
  toolIcon,
  truncateText,
} from "@tracepilot/ui";
import { useAgentTreeContext } from "@/composables/useAgentTree";

const ctx = useAgentTreeContext();

const AGENT_TYPE_ICONS: Record<string, string> = {
  explore: "🔍",
  "general-purpose": "🛠",
  "code-review": "🔎",
  task: "⚡",
  main: "🤖",
};
</script>

<template>
  <Transition name="detail-panel">
    <div v-if="ctx.selectedNode.value" class="detail-panel">
      <div class="detail-panel-header">
        <span class="detail-panel-icon">
          {{ AGENT_TYPE_ICONS[ctx.selectedNode.value.type] ?? "🤖" }}
        </span>
        <h3 class="detail-panel-title">{{ ctx.selectedNode.value.displayName }}</h3>
        <button
          class="detail-panel-close"
          aria-label="Close detail panel"
          @click="ctx.closeDetail()"
        >
          ✕
        </button>
      </div>

      <div class="detail-panel-info">
        <div v-if="ctx.selectedNode.value.description" class="detail-info-row">
          <span class="detail-label">Description</span>
          <span class="detail-value">{{ ctx.selectedNode.value.description }}</span>
        </div>
        <div
          v-if="ctx.selectedNode.value.isCrossTurnParent && ctx.selectedNode.value.sourceTurnIndex != null"
          class="detail-info-row"
        >
          <span class="detail-label">Source</span>
          <span class="detail-value detail-value--italic">
            Launched in turn {{ ctx.selectedNode.value.sourceTurnIndex }}
          </span>
        </div>
        <div v-if="ctx.agentPrompt(ctx.selectedNode.value)" class="detail-section">
          <h4 class="detail-section-title">Prompt</h4>
          <MarkdownContent
            :content="ctx.agentPrompt(ctx.selectedNode.value)!"
            :render="ctx.prefs.isFeatureEnabled('renderMarkdown')"
            max-height="200px"
          />
        </div>
        <div class="detail-info-grid">
          <div class="detail-info-item">
            <span class="detail-label">Status</span>
            <Badge
              :variant="
                ctx.selectedNode.value.status === 'completed'
                  ? 'success'
                  : ctx.selectedNode.value.status === 'failed'
                    ? 'danger'
                    : 'warning'
              "
            >
              {{ STATUS_ICONS[ctx.selectedNode.value.status] }}
              {{ ctx.selectedNode.value.status }}
            </Badge>
          </div>
          <div class="detail-info-item">
            <span class="detail-label">Duration</span>
            <span class="detail-value">
              {{ formatLiveDuration(ctx.liveDuration(ctx.selectedNode.value)) || "—" }}
            </span>
          </div>
          <div class="detail-info-item">
            <span class="detail-label">Tools</span>
            <span class="detail-value">{{ ctx.selectedNode.value.toolCount }}</span>
          </div>
          <div v-if="ctx.selectedNode.value.model" class="detail-info-item">
            <span class="detail-label">Model</span>
            <Badge variant="done">{{ ctx.selectedNode.value.model }}</Badge>
            <span
              v-if="ctx.selectedNode.value.status !== 'in-progress' && ctx.selectedNode.value.requestedModel && ctx.selectedNode.value.model !== ctx.selectedNode.value.requestedModel"
              class="detail-model-warn"
              :title="`Requested ${ctx.selectedNode.value.requestedModel} but a different model ran`"
            >⚠ substituted</span>
          </div>
          <div v-if="ctx.selectedNode.value.totalTokens" class="detail-info-item">
            <span class="detail-label">Tokens</span>
            <span class="detail-value">{{ formatNumber(ctx.selectedNode.value.totalTokens) }}</span>
          </div>
        </div>
      </div>

      <div
        v-if="ctx.selectedNode.value.status === 'failed' && ctx.selectedNode.value.toolCallRef?.error"
        class="detail-section detail-failure"
      >
        <h4 class="detail-section-title detail-failure-title">❌ Failure Reason</h4>
        <pre class="detail-failure-body">{{ ctx.selectedNode.value.toolCallRef.error }}</pre>
      </div>

      <div
        v-if="ctx.selectedNode.value.messages.filter(m => m.trim()).length > 0"
        class="detail-section"
      >
        <h4 class="detail-section-title">Output</h4>
        <div
          class="detail-output"
          :class="{
            'detail-output--collapsed':
              ctx.selectedNode.value.messages.filter(m => m.trim()).join('').length > 500 &&
              !ctx.expandedOutputs.has(ctx.selectedNode.value.id),
            'detail-output--expanded': ctx.expandedOutputs.has(ctx.selectedNode.value.id),
          }"
        >
          <MarkdownContent
            v-for="(msg, idx) in ctx.selectedNode.value.messages.filter(m => m.trim())"
            :key="`output-msg-${idx}`"
            class="detail-output-message"
            :content="msg"
            :render="ctx.prefs.isFeatureEnabled('renderMarkdown')"
          />
        </div>
        <button
          v-if="ctx.selectedNode.value.messages.filter(m => m.trim()).join('').length > 500"
          class="output-toggle"
          @click="ctx.expandedOutputs.toggle(ctx.selectedNode.value.id)"
        >
          {{ ctx.expandedOutputs.has(ctx.selectedNode.value.id) ? "▲ Show less" : "▼ Show more" }}
        </button>
      </div>

      <div
        v-if="ctx.selectedNode.value.toolCallRef?.resultContent || (ctx.selectedNode.value.toolCallRef?.toolCallId && ctx.fullResults.has(ctx.selectedNode.value.toolCallRef.toolCallId))"
        class="detail-section"
      >
        <h4 class="detail-section-title">Result</h4>
        <div class="detail-output">
          <ToolResultRenderer
            :tc="ctx.selectedNode.value.toolCallRef!"
            :content="ctx.fullResults.get(ctx.selectedNode.value.toolCallRef!.toolCallId ?? '') ?? ctx.selectedNode.value.toolCallRef!.resultContent ?? ''"
            :rich-enabled="ctx.prefs.isFeatureEnabled('renderMarkdown') && ['read_agent', 'task'].includes(ctx.selectedNode.value.toolCallRef!.toolName) ? true : ctx.prefs.isRichRenderingEnabled(ctx.selectedNode.value.toolCallRef!.toolName)"
            :is-truncated="!!(ctx.selectedNode.value.toolCallRef!.toolCallId && ctx.selectedNode.value.toolCallRef!.resultContent?.includes('…[truncated]') && !ctx.fullResults.has(ctx.selectedNode.value.toolCallRef!.toolCallId ?? ''))"
            :loading="!!(ctx.selectedNode.value.toolCallRef!.toolCallId && ctx.loadingResults.has(ctx.selectedNode.value.toolCallRef!.toolCallId))"
            @load-full="ctx.loadFullResult(ctx.selectedNode.value.toolCallRef!.toolCallId!)"
          />
        </div>
      </div>

      <div v-if="ctx.selectedNode.value.reasoning.length > 0" class="detail-section">
        <button
          class="reasoning-toggle"
          :aria-expanded="ctx.expandedReasoning.has(ctx.selectedNode.value.id)"
          @click="ctx.expandedReasoning.toggle(ctx.selectedNode.value.id)"
        >
          <ExpandChevron :expanded="ctx.expandedReasoning.has(ctx.selectedNode.value.id)" />
          💭 {{ ctx.selectedNode.value.reasoning.length }} reasoning block{{ ctx.selectedNode.value.reasoning.length !== 1 ? "s" : "" }}
        </button>
        <div
          v-if="ctx.expandedReasoning.has(ctx.selectedNode.value.id)"
          class="reasoning-content"
          tabindex="0"
        >
          <template v-for="(text, rIdx) in ctx.selectedNode.value.reasoning" :key="`reasoning-${rIdx}`">
            <hr v-if="rIdx > 0" class="reasoning-divider" />
            <MarkdownContent :content="text" :render="ctx.prefs.isFeatureEnabled('renderMarkdown')" />
          </template>
        </div>
      </div>

      <div class="detail-tools">
        <h4 class="detail-tools-heading">
          {{ ctx.selectedNode.value.type === "main" ? "Tools & Agents" : "Tool Calls" }}
          <span class="detail-tools-count">({{ ctx.selectedNode.value.toolCalls.length }})</span>
        </h4>

        <EmptyState
          v-if="ctx.selectedNode.value.toolCalls.length === 0"
          message="No tool calls recorded."
        />

        <div v-else class="detail-tools-list">
          <div
            v-for="(tc, idx) in ctx.selectedNode.value.toolCalls"
            :key="tc.toolCallId ?? idx"
            class="detail-tool-row"
          >
            <button
              type="button"
              class="detail-tool-btn"
              :aria-expanded="ctx.expandedToolCalls.has(tc.toolCallId ?? `tc-${idx}`)"
              @click="ctx.expandedToolCalls.toggle(tc.toolCallId ?? `tc-${idx}`)"
            >
              <span class="detail-tool-idx">{{ idx + 1 }}.</span>
              <span class="detail-tool-icon">{{ toolIcon(tc.toolName) }}</span>
              <span class="detail-tool-name">
                {{ tc.isSubagent && tc.agentDisplayName ? tc.agentDisplayName : tc.toolName }}
              </span>
              <Badge v-if="tc.isSubagent" variant="neutral" class="detail-agent-badge">agent</Badge>
              <span
                v-if="tc.intentionSummary"
                class="tool-call-intent"
                :title="tc.intentionSummary"
                style="flex: 1;"
              >
                {{ truncateText(tc.intentionSummary, 60) }}
              </span>
              <span
                v-else-if="formatArgsSummary(tc.arguments, tc.toolName)"
                class="detail-tool-args"
                :title="formatArgsSummary(tc.arguments, tc.toolName)"
              >
                ({{ truncateText(formatArgsSummary(tc.arguments, tc.toolName), 60) }})
              </span>
              <span class="detail-tool-right">
                <span v-if="tc.durationMs != null" class="detail-tool-dur">
                  {{ formatDuration(tc.durationMs) }}
                </span>
                <span v-if="tc.success === true" class="detail-tool-status success">✓</span>
                <span v-else-if="tc.success === false" class="detail-tool-status failed">✗</span>
                <span v-else class="detail-tool-status pending">○</span>
              </span>
            </button>

            <div
              v-if="ctx.expandedToolCalls.has(tc.toolCallId ?? `tc-${idx}`)"
              class="detail-tool-expanded"
            >
              <div v-if="tc.error" class="detail-tool-error">
                <div class="detail-tool-error-label">Error</div>
                <pre class="detail-tool-error-body">{{ tc.error }}</pre>
              </div>
              <div class="detail-tool-meta">
                <div v-if="tc.startedAt" class="detail-meta-item">
                  <span class="detail-label">Started</span>
                  <span class="detail-value">{{ formatTime(tc.startedAt) }}</span>
                </div>
                <div v-if="tc.completedAt" class="detail-meta-item">
                  <span class="detail-label">Completed</span>
                  <span class="detail-value">{{ formatTime(tc.completedAt) }}</span>
                </div>
                <div v-if="tc.durationMs != null" class="detail-meta-item">
                  <span class="detail-label">Duration</span>
                  <span class="detail-value">{{ formatDuration(tc.durationMs) }}</span>
                </div>
                <div v-if="tc.toolCallId" class="detail-meta-item">
                  <span class="detail-label">Call ID</span>
                  <span class="detail-value font-mono">{{ tc.toolCallId }}</span>
                </div>
              </div>
              <ToolArgsRenderer :tc="tc" :rich-enabled="ctx.prefs.isRichRenderingEnabled(tc.toolName)" />

              <div
                v-if="tc.resultContent || (tc.toolCallId && ctx.fullResults.has(tc.toolCallId))"
                class="tool-result-section"
              >
                <ToolResultRenderer
                  :tc="tc"
                  :content="ctx.fullResults.get(tc.toolCallId ?? '') ?? tc.resultContent ?? ''"
                  :rich-enabled="ctx.prefs.isRichRenderingEnabled(tc.toolName)"
                  :is-truncated="!!(tc.toolCallId && tc.resultContent?.includes('…[truncated]') && !ctx.fullResults.has(tc.toolCallId))"
                  :loading="!!(tc.toolCallId && ctx.loadingResults.has(tc.toolCallId))"
                  @load-full="ctx.loadFullResult(tc.toolCallId!)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
