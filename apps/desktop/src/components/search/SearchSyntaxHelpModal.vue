<script setup lang="ts">
defineProps<{ visible: boolean }>();
defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="syntax-help-overlay" @click.self="$emit('close')">
        <div class="syntax-help-modal">
          <div class="syntax-help-header">
            <h3>Search Syntax Guide</h3>
            <button class="syntax-help-close" aria-label="Close" @click="$emit('close')">✕</button>
          </div>
          <div class="syntax-help-body">
            <section class="syntax-section">
              <h4>Text Search</h4>
              <div class="syntax-row"><code>"exact phrase"</code><span>Match an exact phrase</span></div>
              <div class="syntax-row"><code>prefix*</code><span>Match words starting with prefix</span></div>
              <div class="syntax-row"><code>term1 AND term2</code><span>Both terms must appear</span></div>
              <div class="syntax-row"><code>term1 OR term2</code><span>Either term may appear</span></div>
              <div class="syntax-row"><code>NOT term</code><span>Exclude results containing term</span></div>
              <div class="syntax-row"><code>NEAR(a b, 5)</code><span>Terms within 5 tokens of each other</span></div>
            </section>
            <section class="syntax-section">
              <h4>Qualifier Filters</h4>
              <div class="syntax-row"><code>type:error</code><span>Filter by content type (error, tool_call, user_message, reasoning, etc.)</span></div>
              <div class="syntax-row"><code>repo:myproject</code><span>Filter by repository name</span></div>
              <div class="syntax-row"><code>tool:grep</code><span>Filter by tool name</span></div>
              <div class="syntax-row"><code>session:abc123</code><span>Filter to a specific session</span></div>
              <div class="syntax-row"><code>sort:newest</code><span>Sort by newest, oldest, or relevance</span></div>
            </section>
            <section class="syntax-section">
              <h4>Examples</h4>
              <div class="syntax-row"><code>type:error "rate limit"</code><span>Find rate limit errors</span></div>
              <div class="syntax-row"><code>tool:grep migration</code><span>Grep results about migrations</span></div>
              <div class="syntax-row"><code>"TODO" type:tool_result</code><span>Find TODOs in tool outputs</span></div>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.syntax-help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.syntax-help-modal {
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  width: min(560px, 90vw);
  max-height: 80vh;
  overflow-y: auto;
}
.syntax-help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
}
.syntax-help-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
.syntax-help-close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 1.1rem;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.syntax-help-close:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}
.syntax-help-body {
  padding: 16px 20px;
}
.syntax-section {
  margin-bottom: 16px;
}
.syntax-section:last-child {
  margin-bottom: 0;
}
.syntax-section h4 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin: 0 0 8px 0;
}
.syntax-row {
  display: flex;
  gap: 12px;
  padding: 4px 0;
  font-size: 0.8125rem;
  align-items: baseline;
}
.syntax-row code {
  flex-shrink: 0;
  min-width: 180px;
  background: var(--canvas-subtle);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  color: var(--accent-fg);
}
.syntax-row span {
  color: var(--text-secondary);
}
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
