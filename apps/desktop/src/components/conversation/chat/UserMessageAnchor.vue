<script setup lang="ts">
import { MarkdownContent } from "@tracepilot/ui";
import { User } from "lucide-vue-next";
import { computed } from "vue";
import { useConversationTime } from "@/components/conversation/conversationTime";
import { promptPreviewText, splitPastedContent } from "@/utils/pastedContent";
import MessageCopyButton from "./MessageCopyButton.vue";
import PastedContentBlock from "./PastedContentBlock.vue";
import PromptImages from "./PromptImages.vue";

const props = defineProps<{
  content: string;
  turnIndex: number;
  timestamp?: string | null;
  eventIndex?: number | null;
  renderMarkdown: boolean;
  /** The prompt's attachments; images among them show under the text. */
  attachments?: unknown[] | null;
  sessionId?: string | null;
}>();
const timeLabel = useConversationTime();

const parts = computed(() => splitPastedContent(props.content));
/** The prompt as typed and pasted, without Claude Code's paste wrapper tags. */
const copyText = computed(() => promptPreviewText(props.content));
</script>

<template>
  <div
    class="cv-user-anchor cv-msg-copy-host"
    :data-event-idx="eventIndex != null ? eventIndex : undefined"
  >
    <div class="cv-user-header">
      <span class="cv-user-avatar" aria-hidden="true"><User :size="16" /></span>
      <span class="cv-user-name">User</span>
      <span class="cv-user-turn">T{{ turnIndex }}</span>
      <MessageCopyButton :text="copyText" label="Copy prompt" />
      <span v-if="timestamp" class="cv-user-time" :title="timeLabel(timestamp).title">
        {{ timeLabel(timestamp).text }}
      </span>
    </div>
    <div class="cv-user-body">
      <template v-for="(part, index) in parts" :key="index">
        <PastedContentBlock
          v-if="part.kind === 'pasted'"
          :content="part.text"
          :render-markdown="renderMarkdown"
        />
        <MarkdownContent v-else :content="part.text" :render="renderMarkdown" />
      </template>
      <PromptImages
        v-if="sessionId && eventIndex != null && attachments?.length"
        :session-id="sessionId"
        :event-index="eventIndex"
        :attachments="attachments"
      />
    </div>
  </div>
</template>

<style scoped>
.cv-user-anchor {
  border-left: 3px solid var(--accent-emphasis);
  background: var(--canvas-subtle);
  border-radius: 0 var(--radius-md, 8px) var(--radius-md, 8px) 0;
  padding: 12px 16px;
  margin: 12px 0 4px;
}

.cv-user-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.cv-user-avatar {
  font-size: 16px;
  flex-shrink: 0;
}

.cv-user-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--accent-fg);
}

.cv-user-turn {
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
  color: var(--text-placeholder);
}

/* The copy button takes the free space, so the time stays put when "Copied" widens it. */
.cv-user-header .cv-msg-copy {
  margin-left: auto;
}

/* Room for the focus ring. */
.cv-msg-copy + .cv-user-time {
  margin-left: 4px;
}

.cv-user-time {
  font-size: 11px;
  color: var(--text-placeholder);
}

.cv-user-body {
  position: relative;
  background: var(--accent-subtle, rgba(56, 139, 253, 0.08));
  border: 1px solid var(--accent-muted, rgba(56, 139, 253, 0.15));
  border-radius: var(--radius-md, 8px);
  padding: 12px 16px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-primary);
  overflow-wrap: break-word;
}
</style>
