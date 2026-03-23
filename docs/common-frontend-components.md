# Common Frontend Components

Shared UI components and composables provided by the `@tracepilot/ui` package.

This document covers the notification, dialog, error display, loading, and clipboard primitives that every TracePilot frontend feature should use. These components were introduced as part of a frontend normalization effort to replace ad-hoc patterns with a single, consistent set of building blocks.

---

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Toast System](#toast-system)
4. [Confirmation Dialog](#confirmation-dialog)
5. [Error Display](#error-display)
6. [Loading States](#loading-states)
7. [Clipboard](#clipboard)
8. [Migration Guide](#migration-guide)
9. [Accessibility](#accessibility)
10. [Design Decisions](#design-decisions)

---

## Overview

The `@tracepilot/ui` package is the single source of truth for all shared Vue components in TracePilot. It is consumed by the desktop app (`apps/desktop`) and any future web targets.

The common components fall into several categories:

| Category | Components / Composables |
|---|---|
| Toasts | `useToast`, `ToastContainer` |
| Confirmation | `useConfirmDialog`, `ConfirmDialog` |
| Error display | `ErrorAlert`, `ErrorState` |
| Loading states | `LoadingSpinner`, `LoadingOverlay`, `SkeletonLoader` |
| Clipboard | `useClipboard` |

All of these are re-exported from `@tracepilot/ui` — no deep imports needed.

---

## Getting Started

### 1. Import what you need

```ts
// Components
import {
  ToastContainer,
  ConfirmDialog,
  ErrorAlert,
  ErrorState,
  LoadingSpinner,
  LoadingOverlay,
  SkeletonLoader,
} from '@tracepilot/ui';

// Composables & types
import {
  useToast,
  useConfirmDialog,
  useClipboard,
  type ToastOptions,
  type Toast,
  type ConfirmOptions,
  type ConfirmResult,
  type ConfirmVariant,
  type UseClipboardOptions,
  type UseClipboardReturn,
} from '@tracepilot/ui';
```

### 2. Mount global singletons once in App.vue

`ToastContainer` and `ConfirmDialog` are **singleton renderers** — mount them once at the root of the app, outside any routed content. In `apps/desktop/src/App.vue`:

```vue
<template>
  <!-- ... routed content ... -->

  <!-- Global UI hosts — mounted once, consumed by composables everywhere -->
  <ToastContainer />
  <ConfirmDialog />
</template>
```

That's it. Every call to `useToast()` or `useConfirmDialog()` from anywhere in the app will target these same instances.

---

## Toast System

### Composable: `useToast()`

A module-level singleton that manages a stack of toast notifications. Call it from any component or store — all callers share the same reactive `toasts` array.

#### Return type

```ts
{
  toasts: Readonly<Ref<Toast[]>>;
  toast:       (options: ToastOptions | string) => string;
  success:     (message: string, options?: Partial<ToastOptions>) => string;
  error:       (message: string, options?: Partial<ToastOptions>) => string;
  warning:     (message: string, options?: Partial<ToastOptions>) => string;
  info:        (message: string, options?: Partial<ToastOptions>) => string;
  dismiss:     (id: string) => void;
  clear:       () => void;
  pauseTimer:  (id: string) => void;
  resumeTimer: (id: string) => void;
}
```

Each method that creates a toast returns the toast `id` (a string), which can be passed to `dismiss()` later.

#### Types

```ts
interface ToastOptions {
  message: string;
  title?: string;
  description?: string;
  type?: 'success' | 'error' | 'warning' | 'info'; // default: 'info'
  /** Auto-dismiss delay in ms. Default 3000. Use 0 for persistent toasts. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface Toast extends Required<Pick<ToastOptions, 'message' | 'type'>> {
  id: string;
  title?: string;
  description?: string;
  duration: number;
  action?: { label: string; onClick: () => void };
  createdAt: number;
}
```

#### Examples

**Simple string toast (defaults to `info`, 3 s)**

```ts
const { toast } = useToast();
toast('Session imported successfully');
```

**Typed convenience methods**

```ts
const { success, error, warning, info } = useToast();

success('Trace saved');
error('Import failed — file is corrupt');
warning('Session has no tool calls');
info('Indexing in progress…');
```

**With title and description**

```ts
success('Import complete', {
  title: 'Session import',
  description: '42 tool calls indexed across 3 agents',
});
```

**Persistent toast (no auto-dismiss)**

```ts
const id = error('Connection lost. Retrying…', { duration: 0 });

// Later, when reconnected:
dismiss(id);
```

**Action button**

```ts
const { toast: showToast } = useToast();

showToast({
  message: 'Session deleted',
  type: 'success',
  action: {
    label: 'Undo',
    onClick: () => restoreSession(sessionId),
  },
});
```

**Timer pause/resume (hover behaviour)**

`ToastContainer` pauses the auto-dismiss countdown when the user hovers over a toast and resumes on mouse-leave. This is handled automatically — you only need `pauseTimer` / `resumeTimer` if you build a custom toast renderer.

### Component: `<ToastContainer />`

Renders the toast stack. Positioned `fixed` at the bottom-right corner. No props — it reads from the singleton state internally.

Features:
- Animated slide-in / slide-out (`TransitionGroup`)
- Progress bar showing time remaining (pauses on hover)
- Dismiss button on every toast
- Max 5 visible toasts (oldest evicted first)
- `aria-live="polite"` for screen readers (`assertive` for error toasts)
- Respects `prefers-reduced-motion`

### Pinia wrapper: `useToastStore`

For Pinia store-to-store scenarios where you can't call a composable, `apps/desktop` provides a thin Pinia wrapper:

```ts
// apps/desktop/src/stores/toast.ts
import { defineStore } from 'pinia';
import { useToast } from '@tracepilot/ui';

export const useToastStore = defineStore('toast', () => {
  const { toasts, toast, success, error, warning, info, dismiss, clear } = useToast();
  return { toasts, toast, success, error, warning, info, dismiss, clear };
});
```

Usage inside another Pinia store:

```ts
import { useToastStore } from '@/stores/toast';

export const useSessionsStore = defineStore('sessions', () => {
  async function deleteSession(id: string) {
    try {
      await invoke('delete_session', { id });
      const toastStore = useToastStore();
      toastStore.success('Session deleted');
    } catch (err) {
      const toastStore = useToastStore();
      toastStore.error('Failed to delete session');
    }
  }
  // ...
});
```

---

## Confirmation Dialog

### Composable: `useConfirmDialog()`

A module-level singleton that opens a modal confirmation dialog and returns a `Promise<ConfirmResult>`.

#### Return type

```ts
{
  options: Readonly<Ref<ConfirmOptions | null>>;
  visible: Readonly<Ref<boolean>>;
  confirm: (opts: ConfirmOptions) => Promise<ConfirmResult>;
  resolve: (result: ConfirmResult) => void;
}
```

`confirm()` is the primary API — call it from any component. `resolve()` is used internally by the `ConfirmDialog` renderer component.

#### Types

```ts
type ConfirmVariant = 'danger' | 'warning' | 'info';

interface ConfirmOptions {
  title: string;
  message: string;
  variant?: ConfirmVariant;       // default: 'info'
  confirmLabel?: string;          // default: 'Confirm'
  cancelLabel?: string;           // default: 'Cancel'
  /** Optional checkbox label shown above the footer buttons. */
  checkbox?: string;
}

interface ConfirmResult {
  confirmed: boolean;
  /** `false` if no checkbox was shown. */
  checked: boolean;
}
```

#### Examples

**Basic confirmation**

```ts
const { confirm } = useConfirmDialog();

const { confirmed } = await confirm({
  title: 'Delete session?',
  message: 'This action cannot be undone.',
  variant: 'danger',
  confirmLabel: 'Delete',
});

if (confirmed) {
  await deleteSession(id);
}
```

**With a "don't ask again" checkbox**

```ts
const { confirmed, checked } = await confirm({
  title: 'Reset preferences?',
  message: 'All custom settings will be reverted to defaults.',
  variant: 'warning',
  confirmLabel: 'Reset',
  checkbox: 'Don\'t ask me again',
});

if (confirmed) {
  resetPreferences();
  if (checked) {
    prefs.suppressResetConfirmation = true;
  }
}
```

**Handling the rejection when a dialog is already open**

Only one confirmation dialog can be open at a time. If `confirm()` is called while another is already visible, it rejects:

```ts
try {
  const result = await confirm({ title: '…', message: '…' });
} catch (err) {
  // "A confirmation dialog is already open"
}
```

### Component: `<ConfirmDialog />`

Renders the modal. No props — it reads singleton state from `useConfirmDialog()`.

Features:
- Variant-specific icons and colours (danger 🗑, warning ⚠, info ℹ)
- Coloured left-border accent bar matching the variant
- Optional checkbox
- Focus is sent to the Cancel button on open (safe default)
- `role="alertdialog"` with `aria-modal="true"`
- Escape key and backdrop click cancel the dialog
- Scale-in animation (respects `prefers-reduced-motion`)

---

## Error Display

### `<ErrorAlert>`

An inline alert bar for contextual errors, warnings, or informational messages.

#### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `message` | `string` | — | Alert text (also accepts slot content) |
| `severity` | `'error' \| 'warning' \| 'info'` | `'error'` | Colour and icon |
| `variant` | `'inline' \| 'banner' \| 'compact'` | `'inline'` | Layout variant |
| `dismissible` | `boolean` | `false` | Show dismiss ✕ button |
| `retryable` | `boolean` | `false` | Show Retry button |

#### Events

| Event | Payload | Description |
|---|---|---|
| `dismiss` | — | Fired when the dismiss button is clicked |
| `retry` | — | Fired when the Retry button is clicked |

#### Examples

**Inline error**

```vue
<ErrorAlert message="Failed to load session data" />
```

**Warning banner with retry**

```vue
<ErrorAlert
  severity="warning"
  variant="banner"
  retryable
  @retry="fetchSessions"
>
  Could not reach the backend. Check that the Rust service is running.
</ErrorAlert>
```

**Dismissible info alert (compact)**

```vue
<ErrorAlert
  severity="info"
  variant="compact"
  dismissible
  @dismiss="hideTip"
  message="Tip: Use Ctrl+K to open the command palette."
/>
```

### `<ErrorState>`

A full-page centered error state for top-level failures.

#### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `heading` | `string` | `'Something went wrong'` | Heading text |
| `message` | `string` | — | Subtext explanation |
| `retryable` | `boolean` | `true` | Show Retry button |

#### Events

| Event | Payload | Description |
|---|---|---|
| `retry` | — | Fired when the Retry button is clicked |

#### Slots

| Slot | Description |
|---|---|
| `heading` | Override heading content |
| `default` | Extra content below the message / retry button |

#### Example

```vue
<ErrorState
  heading="Session not found"
  message="The session may have been deleted or the ID is invalid."
  @retry="router.push('/')"
/>
```

---

## Loading States

### `<LoadingSpinner>`

A lightweight inline SVG spinner.

#### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size preset (16 / 24 / 32 px) |
| `color` | `string` | `'var(--accent-fg)'` | Stroke colour for the animated arc |

#### Example

```vue
<LoadingSpinner />
<LoadingSpinner size="sm" />
<LoadingSpinner size="lg" color="var(--success-fg)" />
```

### `<LoadingOverlay>`

A centered overlay that shows a spinner and optional message while content loads. Uses a slot to render child content once loading completes.

#### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `loading` | `boolean` | *required* | Whether to show the overlay |
| `message` | `string` | — | Optional text below the spinner |

#### Example

```vue
<LoadingOverlay :loading="isLoading" message="Loading session data…">
  <SessionDetail :session="session" />
</LoadingOverlay>
```

### `<SkeletonLoader>`

Placeholder shimmers for content that hasn't loaded yet.

#### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `variant` | `'text' \| 'badge' \| 'card'` | `'text'` | Shape preset |
| `count` | `number` | 2 or 3 (varies) | Number of skeleton elements |

- **`text`** — stacked horizontal bars (default count: 2)
- **`badge`** — row of pill-shaped badges (default count: 3)
- **`card`** — stacked tall card placeholders (default count: 3)

#### Example

```vue
<SkeletonLoader variant="card" :count="4" />
```

---

## Clipboard

### Composable: `useClipboard(options?)`

Per-instance composable (not a singleton) for copying text to the clipboard with a temporary "copied" feedback state.

#### Options

```ts
interface UseClipboardOptions {
  /** Duration in ms to show "copied" state. Default: 2000 */
  duration?: number;
}
```

#### Return type

```ts
interface UseClipboardReturn {
  /** Copy text to clipboard. Returns true on success. */
  copy: (text: string) => Promise<boolean>;
  /** Whether text was recently copied (auto-resets after duration) */
  copied: Ref<boolean>;
  /** Whether the clipboard API is supported */
  isSupported: boolean;
  /** Last error message, if any */
  error: Ref<string | null>;
}
```

#### Examples

**Copy button with visual feedback**

```vue
<script setup lang="ts">
import { useClipboard } from '@tracepilot/ui';

const { copy, copied } = useClipboard();
const traceId = 'abc-123-def';
</script>

<template>
  <button @click="copy(traceId)">
    {{ copied ? '✓ Copied' : 'Copy ID' }}
  </button>
</template>
```

**Combined with toast notification**

```vue
<script setup lang="ts">
import { useClipboard, useToast } from '@tracepilot/ui';

const { copy, error: clipError } = useClipboard();
const { success, error } = useToast();

async function copySessionJson(json: string) {
  const ok = await copy(json);
  if (ok) {
    success('Copied to clipboard');
  } else {
    error(`Copy failed: ${clipError.value}`);
  }
}
</script>
```

**Multiple independent copy buttons**

Each call to `useClipboard()` creates its own state, so multiple buttons can have independent "copied" indicators:

```vue
<script setup lang="ts">
import { useClipboard } from '@tracepilot/ui';

const idClip = useClipboard();
const jsonClip = useClipboard();
</script>

<template>
  <button @click="idClip.copy(sessionId)">
    {{ idClip.copied.value ? '✓' : 'Copy ID' }}
  </button>
  <button @click="jsonClip.copy(sessionJson)">
    {{ jsonClip.copied.value ? '✓' : 'Copy JSON' }}
  </button>
</template>
```

---

## Migration Guide

### Toasts: before and after

**Before** — ad-hoc DOM manipulation or one-off local state:

```vue
<!-- Old: per-component toast state -->
<script setup>
const showSuccess = ref(false);
function onSave() {
  await save();
  showSuccess.value = true;
  setTimeout(() => (showSuccess.value = false), 3000);
}
</script>
<template>
  <div v-if="showSuccess" class="custom-toast">Saved!</div>
</template>
```

**After** — centralized toast system:

```vue
<script setup>
import { useToast } from '@tracepilot/ui';
const { success } = useToast();

async function onSave() {
  await save();
  success('Saved!');
}
</script>
<!-- No template changes needed — ToastContainer handles rendering -->
```

### Confirm dialog: before and after

**Before** — inline confirm state and modal markup:

```vue
<script setup>
const showConfirm = ref(false);
const pendingId = ref('');
function requestDelete(id) {
  pendingId.value = id;
  showConfirm.value = true;
}
function doDelete() {
  deleteSession(pendingId.value);
  showConfirm.value = false;
}
</script>
<template>
  <ModalDialog :visible="showConfirm" @update:visible="showConfirm = $event">
    <p>Are you sure?</p>
    <button @click="doDelete">Delete</button>
    <button @click="showConfirm = false">Cancel</button>
  </ModalDialog>
</template>
```

**After** — one-liner async flow:

```vue
<script setup>
import { useConfirmDialog } from '@tracepilot/ui';
const { confirm } = useConfirmDialog();

async function requestDelete(id) {
  const { confirmed } = await confirm({
    title: 'Delete session?',
    message: 'This action cannot be undone.',
    variant: 'danger',
    confirmLabel: 'Delete',
  });
  if (confirmed) deleteSession(id);
}
</script>
<!-- No template needed — ConfirmDialog is in App.vue -->
```

### Error display: before and after

**Before** — raw conditional `<div>`:

```vue
<div v-if="error" class="error-box" style="color: red;">{{ error }}</div>
```

**After** — semantic, accessible, styled:

```vue
<ErrorAlert v-if="error" :message="error" retryable @retry="load" />
```

### Loading: before and after

**Before** — inline spinner markup:

```vue
<div v-if="loading" class="spinner-wrapper">
  <div class="custom-spinner" />
  <p>Loading…</p>
</div>
<div v-else> … </div>
```

**After** — `LoadingOverlay` handles the toggle:

```vue
<LoadingOverlay :loading="loading" message="Loading…">
  <!-- content -->
</LoadingOverlay>
```

---

## Accessibility

### Toast notifications

- The container uses `aria-live="polite"` so new toasts are announced by screen readers without interrupting the current task.
- Error toasts use `aria-live="assertive"` for immediate announcement.
- Each toast has `role="status"`.
- The dismiss button has `aria-label="Dismiss"`.
- All animations respect `prefers-reduced-motion: reduce`.

### Confirmation dialog

- The dialog body uses `role="alertdialog"` and `aria-modal="true"`.
- `aria-label` is set to the dialog title.
- Focus is moved to the Cancel button on open (safe default — prevents accidental confirmation).
- Pressing Escape or clicking the backdrop cancels the dialog.
- The entrance animation is disabled under `prefers-reduced-motion`.

### Error display

- `ErrorAlert` uses `role="alert"`, which triggers an immediate screen-reader announcement.
- The dismiss button has `aria-label="Dismiss"`.
- SVG icons are marked `aria-hidden="true"`.

### Loading

- `LoadingSpinner` has `role="status"` and a visually-hidden "Loading" text (`.sr-only` class) for screen readers.
- `LoadingOverlay` uses `role="status"` with `aria-live="polite"`.
- Spinner animations are disabled under `prefers-reduced-motion`.

### Keyboard navigation summary

| Component | Key | Action |
|---|---|---|
| Toast | — | Auto-announced; dismiss via mouse only |
| ConfirmDialog | `Escape` | Cancel |
| ConfirmDialog | `Tab` | Move between Cancel / Confirm / checkbox |
| ConfirmDialog | `Enter` | Activate focused button |
| ErrorAlert | `Tab` | Focus Retry / Dismiss buttons |

---

## Design Decisions

### Singleton vs per-instance pattern

`useToast` and `useConfirmDialog` use **module-level singleton state** (a `ref` declared outside the composable function). This means every call to the composable returns references to the same reactive array / object — no matter which component calls it.

This was chosen because:
- There should only ever be one toast stack and one confirm dialog on screen.
- It eliminates the need for `provide`/`inject` boilerplate or a Pinia store for simple UI state.
- It works outside of Vue components (e.g., in router guards or utility functions that have access to the Vue scope).

`useClipboard`, by contrast, creates **per-instance state** because multiple copy buttons may coexist with independent "copied" indicators.

### Why a Pinia wrapper for toasts?

Pinia stores cannot call composables directly during store creation (no component scope). The `useToastStore` in `apps/desktop/src/stores/toast.ts` wraps `useToast()` inside a `defineStore` callback, making toast methods available for store-to-store communication (e.g., `useSessionsStore` showing a toast after a backend call).

### Max 5 visible toasts

When a 6th toast is added, the oldest is immediately evicted. This prevents the toast stack from growing unbounded during rapid-fire operations (e.g., batch import). The constant is `MAX_VISIBLE = 5` in `useToast.ts`.

### Timer pause on hover

When the user hovers over a toast, `pauseTimer` freezes the remaining countdown so the user has time to read it or click an action. On mouse-leave, `resumeTimer` schedules removal with the remaining time. This is a standard UX pattern (matching VS Code, GitHub, etc.).

### ConfirmDialog rejects on double-open

Calling `confirm()` while a dialog is already open rejects with an error. This is intentional — it surfaces programming errors (race conditions) instead of silently queuing dialogs.

### ErrorAlert variants

Three layout variants cover the common use cases:
- **`inline`** — the default; rounded corners, fits inside a card or form section.
- **`banner`** — full-width, no border-radius; used at the top of a page.
- **`compact`** — smaller padding and font; used inside tight UI like table rows or sidebars.

### Design prototypes

> **Note:** HTML prototypes that informed the visual design of these components were removed during docs cleanup. The final implementations in `@tracepilot/ui` are the authoritative reference.
