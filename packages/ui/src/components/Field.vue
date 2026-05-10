<!--
  @slots
    default — the control (FormInput / FormSwitch / Select / BtnGroup / Stepper / custom)
    hint    — optional inline hint right of the control
    actions — optional trailing buttons (Reset, Browse…)
  Standardised form-field row. Provides label / description / error chrome and
  a stable label-for association. Replaces bespoke .setting-row markup.
  See design-system/pages/17-settings.md §Field.
-->
<script setup lang="ts">
import { computed, provide } from "vue";

export type FieldStatus = "clean" | "dirty" | "error";
export type FieldLayout = "inline" | "stacked";

export interface FieldProps {
  label: string;
  description?: string;
  /** <label for="…"> association; auto-generated if omitted. */
  for?: string;
  layout?: FieldLayout;
  status?: FieldStatus;
  /** Rendered into aria-live region when status='error'. */
  errorMessage?: string;
  /** Marks the field as required (visual + aria). */
  required?: boolean;
  /** Additional tokens this field matches in panel-level search. */
  searchTokens?: string[];
}

const props = withDefaults(defineProps<FieldProps>(), {
  layout: "inline",
  status: "clean",
  required: false,
});

const fieldId = computed(() => props.for ?? `field-${Math.random().toString(36).slice(2, 9)}`);
const descId = computed(() => `${fieldId.value}-desc`);
const errId = computed(() => `${fieldId.value}-err`);

const ariaDescribedBy = computed(() => {
  const ids: string[] = [];
  if (props.description) ids.push(descId.value);
  if (props.status === "error" && props.errorMessage) ids.push(errId.value);
  return ids.length ? ids.join(" ") : undefined;
});

// Expose to nested controls that opt-in.
provide("tp-field-id", fieldId);
provide("tp-field-described-by", ariaDescribedBy);
provide(
  "tp-field-invalid",
  computed(() => props.status === "error"),
);
</script>

<template>
  <div
    data-tp-component="Field"
    class="field"
    :class="[
      `field--${layout}`,
      `field--status-${status}`,
      { 'field--required': required },
    ]"
    :data-search-tokens="searchTokens?.join(' ')"
  >
    <div class="field__info">
      <label :for="fieldId" class="field__label">
        {{ label }}
        <span v-if="required" aria-hidden="true" class="field__required">*</span>
      </label>
      <p v-if="description" :id="descId" class="field__desc">{{ description }}</p>
    </div>
    <div class="field__control">
      <div class="field__control-row">
        <slot
          :id="fieldId"
          :aria-describedby="ariaDescribedBy"
          :aria-invalid="status === 'error' ? 'true' : undefined"
          :aria-required="required ? 'true' : undefined"
        />
        <span v-if="$slots.hint" class="field__hint">
          <slot name="hint" />
        </span>
        <span v-if="$slots.actions" class="field__actions">
          <slot name="actions" />
        </span>
      </div>
      <p
        v-if="status === 'error' && errorMessage"
        :id="errId"
        class="field__error"
        role="alert"
        aria-live="polite"
      >{{ errorMessage }}</p>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: grid;
  gap: 8px;
  padding: 8px 0;
}

.field--inline {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  align-items: center;
  gap: 16px;
}

.field--stacked {
  grid-template-columns: minmax(0, 1fr);
}

.field__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.field__label {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--text-primary);
}

.field__required {
  color: var(--danger-fg);
  margin-left: 2px;
}

.field__desc {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
}

.field__control {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field__control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.field__hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.field__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.field__error {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--danger-fg);
}

.field--status-error .field__label {
  color: var(--text-primary);
}
</style>
