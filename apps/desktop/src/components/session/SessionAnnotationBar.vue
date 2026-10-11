<script setup lang="ts">
/**
 * Star, archive, tags and note for one session, under the session header.
 *
 * Everything is saved to TracePilot's own annotation store; the session's
 * files are never modified, and archiving only hides it from the list.
 */
import { ActionButton } from "@tracepilot/ui";
import { Archive, ArchiveRestore, NotebookPen, Star, Tag, X } from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import { useSessionAnnotationsStore } from "@/stores/sessionAnnotations";

const props = defineProps<{ sessionId: string }>();

const annotations = useSessionAnnotationsStore();
void annotations.load();
void annotations.watchChanges();

const annotation = computed(() => annotations.get(props.sessionId));
const starred = computed(() => annotation.value?.starred === true);
const archived = computed(() => annotation.value?.archived === true);
const tags = computed(() => annotation.value?.tags ?? []);
const note = computed(() => annotation.value?.note ?? "");

const tagSuggestionsId = computed(() => `session-tag-suggestions-${props.sessionId}`);
const tagSuggestions = computed(() => {
  const current = new Set(tags.value.map((t) => t.toLowerCase()));
  return annotations.allTags.filter(({ tag }) => !current.has(tag.toLowerCase()));
});

const newTag = ref("");

function addTag() {
  const tag = newTag.value.trim().split(/\s+/).join(" ");
  newTag.value = "";
  if (!tag || tags.value.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
  void annotations.setTags(props.sessionId, [...tags.value, tag]);
}

function removeTag(tag: string) {
  void annotations.setTags(
    props.sessionId,
    tags.value.filter((t) => t !== tag),
  );
}

function onTagKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    addTag();
  } else if (event.key === "Backspace" && !newTag.value && tags.value.length > 0) {
    removeTag(tags.value[tags.value.length - 1]);
  }
}

const editingNote = ref(false);
const noteDraft = ref("");
const noteInput = ref<HTMLTextAreaElement | null>(null);

function editNote() {
  noteDraft.value = note.value;
  editingNote.value = true;
  void nextTick(() => noteInput.value?.focus());
}

async function saveNote() {
  const saved = await annotations.setNote(props.sessionId, noteDraft.value);
  if (saved) editingNote.value = false;
}

function cancelNote() {
  editingNote.value = false;
}

function onNoteKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelNote();
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void saveNote();
  }
}

// A different session never inherits an open editor or a half-typed tag.
watch(
  () => props.sessionId,
  () => {
    editingNote.value = false;
    newTag.value = "";
  },
);
</script>

<template>
  <section class="annotation-bar" aria-label="Your notes on this session" data-testid="session-annotations">
    <div class="annotation-row">
      <ActionButton
        size="sm"
        :class="{ 'annotation-toggle--on': starred }"
        :aria-pressed="starred"
        data-testid="session-star-button"
        @click="annotations.toggleStar(sessionId)"
      >
        <Star :size="14" aria-hidden="true" :fill="starred ? 'currentColor' : 'none'" />
        {{ starred ? "Starred" : "Star" }}
      </ActionButton>
      <ActionButton
        size="sm"
        :title="archived ? 'Show this session in the session list again' : 'Hide this session from the session list. Nothing is deleted.'"
        data-testid="session-archive-button"
        @click="annotations.setArchived(sessionId, !archived)"
      >
        <component :is="archived ? ArchiveRestore : Archive" :size="14" aria-hidden="true" />
        {{ archived ? "Unarchive" : "Archive" }}
      </ActionButton>
      <ActionButton
        v-if="!note && !editingNote"
        size="sm"
        data-testid="session-add-note"
        @click="editNote"
      >
        <NotebookPen :size="14" aria-hidden="true" />
        Add note
      </ActionButton>

      <div class="annotation-tags" role="group" aria-label="Tags">
        <Tag :size="14" aria-hidden="true" class="annotation-tags__icon" />
        <span v-for="tag in tags" :key="tag" class="annotation-tag" data-testid="session-detail-tag">
          {{ tag }}
          <button
            type="button"
            class="annotation-tag__remove"
            :aria-label="`Remove tag ${tag}`"
            @click="removeTag(tag)"
          >
            <X :size="12" aria-hidden="true" />
          </button>
        </span>
        <input
          v-model="newTag"
          class="annotation-tag-input"
          :list="tagSuggestionsId"
          placeholder="Add tag"
          aria-label="Add tag"
          maxlength="40"
          data-testid="session-tag-input"
          @keydown="onTagKeydown"
          @blur="addTag"
        />
        <datalist :id="tagSuggestionsId">
          <option v-for="{ tag } in tagSuggestions" :key="tag" :value="tag" />
        </datalist>
      </div>

      <span v-if="archived" class="annotation-hint" data-testid="session-archived-hint">
        Archived: hidden from the session list
      </span>
    </div>

    <div v-if="editingNote" class="annotation-note annotation-note--editing">
      <textarea
        ref="noteInput"
        v-model="noteDraft"
        class="annotation-note__input"
        rows="4"
        maxlength="20000"
        aria-label="Note"
        placeholder="What did you find in this session?"
        data-testid="session-note-input"
        @keydown="onNoteKeydown"
      />
      <div class="annotation-note__actions">
        <span class="annotation-hint">Ctrl+Enter to save, Esc to cancel</span>
        <ActionButton size="sm" variant="ghost" @click="cancelNote">Cancel</ActionButton>
        <ActionButton size="sm" variant="primary" data-testid="session-note-save" @click="saveNote">
          Save note
        </ActionButton>
      </div>
    </div>
    <div v-else-if="note" class="annotation-note" data-testid="session-note">
      <NotebookPen :size="14" aria-hidden="true" class="annotation-note__icon" />
      <p class="annotation-note__text">{{ note }}</p>
      <ActionButton size="sm" variant="ghost" data-testid="session-edit-note" @click="editNote">
        Edit
      </ActionButton>
    </div>
  </section>
</template>

<style scoped>
.annotation-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.annotation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.annotation-row :deep(.action-btn__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.annotation-toggle--on {
  color: var(--accent-fg);
  border-color: var(--border-accent);
}

.annotation-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.annotation-tags__icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.annotation-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  background: var(--accent-subtle);
  color: var(--accent-fg);
  border: 1px solid var(--border-accent);
}

.annotation-tag__remove {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: inherit;
  cursor: pointer;
}

.annotation-tag__remove:hover {
  color: var(--text-primary);
}

.annotation-tag-input {
  width: 120px;
  padding: 2px 8px;
  font-size: 0.75rem;
  color: var(--text-primary);
  background: transparent;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-sm);
}

.annotation-tag-input:focus {
  border-style: solid;
  border-color: var(--accent-fg);
}

.annotation-hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.annotation-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}

.annotation-note--editing {
  flex-direction: column;
  align-items: stretch;
}

.annotation-note__icon {
  margin-top: 2px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.annotation-note__text {
  flex: 1 1 auto;
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-width: 75ch;
}

.annotation-note > :last-child:not(.annotation-note__actions) {
  margin-left: auto;
}

.annotation-note__input {
  width: 100%;
  min-height: 80px;
  padding: 8px;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text-primary);
  background: var(--canvas-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  resize: vertical;
}

.annotation-note__input:focus {
  border-color: var(--accent-fg);
}

.annotation-note__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
</style>
