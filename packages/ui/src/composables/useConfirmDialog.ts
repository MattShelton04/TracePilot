import { ref, readonly, type Ref } from "vue";

export type ConfirmVariant = "danger" | "warning" | "info";

export interface ConfirmOptions {
  title: string;
  message: string;
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional checkbox label text shown above the footer buttons. */
  checkbox?: string;
}

export interface ConfirmResult {
  confirmed: boolean;
  /** `false` if no checkbox was shown. */
  checked: boolean;
}

// Module-level singleton state shared across all callers.
const options = ref<ConfirmOptions | null>(null);
const visible = ref(false);
let pendingResolve: ((result: ConfirmResult) => void) | null = null;

function confirm(opts: ConfirmOptions): Promise<ConfirmResult> {
  // If a dialog is already open, resolve immediately as cancelled
  // rather than rejecting — avoids unhandled rejection in callers.
  if (pendingResolve) {
    return Promise.resolve({ confirmed: false, checked: false });
  }

  options.value = opts;
  visible.value = true;

  return new Promise<ConfirmResult>((res) => {
    pendingResolve = res;
  });
}

function resolve(result: ConfirmResult): void {
  visible.value = false;
  options.value = null;

  if (pendingResolve) {
    const fn = pendingResolve;
    pendingResolve = null;
    fn(result);
  }
}

export function useConfirmDialog(): {
  options: Readonly<Ref<ConfirmOptions | null>>;
  visible: Readonly<Ref<boolean>>;
  confirm: (opts: ConfirmOptions) => Promise<ConfirmResult>;
  resolve: (result: ConfirmResult) => void;
} {
  return {
    options: readonly(options),
    visible: readonly(visible),
    confirm,
    resolve,
  };
}
