/**
 * useImportFlow — state machine composable for the session import flow.
 *
 * Steps: select → validating → review → importing → complete
 */

import { importSessions, previewImport } from "@tracepilot/client";
import type { ConflictStrategy, ImportPreviewResult, ImportResult } from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { type ComputedRef, computed, onBeforeUnmount, type Ref, ref } from "vue";
import { isTauri, promptForPath } from "@/lib/mocks";
import { tauriDialogOpen } from "@/lib/tauri";
import { logError, logInfo } from "@/utils/logger";

// ── Step Type ──────────────────────────────────────────────────

export type ImportStep = "select" | "validating" | "review" | "importing" | "complete";

// ── Composable Return Type ─────────────────────────────────────

export interface ImportFlowState {
  /** Current step in the import flow. */
  step: Ref<ImportStep>;
  /** Path to the selected .tpx.json file. */
  filePath: Ref<string>;
  /** Display name extracted from the file path. */
  fileName: Ref<string>;
  /** Validation/preview result from the backend. */
  preview: Ref<ImportPreviewResult | null>;
  /** Error message from validation or import, or null. */
  error: Ref<string | null>;
  /** How to handle existing sessions (skip | overwrite | rename). */
  conflictStrategy: Ref<ConflictStrategy>;
  /** Session IDs the user has selected for import. */
  selectedSessions: Ref<string[]>;
  /** Simulated progress percentage (0–100). */
  importProgress: Ref<number>;
  /** Number of sessions successfully imported. */
  importedCount: Ref<number>;
  /** Number of sessions skipped during import. */
  skippedCount: Ref<number>;
  /** Error strings returned from the import command. */
  importErrors: Ref<string[]>;

  /** True if the preview contains any severity:'error' issues. */
  hasErrors: ComputedRef<boolean>;
  /** True when the user can proceed with import. */
  canImport: ComputedRef<boolean>;

  /** Open file picker and begin validation. */
  browseFile: () => Promise<void>;
  /** Validate the currently selected file. */
  validateFile: () => Promise<void>;
  /** Execute the import with current settings. */
  executeImport: () => Promise<void>;
  /** Reset to initial state. */
  reset: () => void;
  /** Toggle a session in the selection list. */
  toggleSession: (sessionId: string) => void;
}

// ── Composable ─────────────────────────────────────────────────

export function useImportFlow(): ImportFlowState {
  // ── Reactive state ──

  const step = ref<ImportStep>("select");
  const filePath = ref("");
  const fileName = ref("");
  const preview = ref<ImportPreviewResult | null>(null);
  const error = ref<string | null>(null);
  const conflictStrategy = ref<ConflictStrategy>("skip");
  const selectedSessions = ref<string[]>([]);
  const importProgress = ref(0);
  const importedCount = ref(0);
  const skippedCount = ref(0);
  const importErrors = ref<string[]>([]);

  // Timer and request tracking
  let activeProgressTimer: ReturnType<typeof setInterval> | null = null;
  const validateGuard = useAsyncGuard();
  const importGuard = useAsyncGuard();

  // ── Computed ──

  const hasErrors = computed(
    () => preview.value?.issues.some((i) => i.severity === "error") ?? false,
  );

  const canImport = computed(
    () => step.value === "review" && !hasErrors.value && selectedSessions.value.length > 0,
  );

  // ── Helpers ──

  /** Stop the simulated progress timer, if running. */
  function clearProgressTimer(): void {
    if (activeProgressTimer) {
      clearInterval(activeProgressTimer);
      activeProgressTimer = null;
    }
  }

  /** Extract file name from a path (cross-platform). */
  function extractFileName(path: string): string {
    const parts = path.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || path;
  }

  /** Internal: set file path and kick off validation. */
  async function selectFile(path: string): Promise<void> {
    filePath.value = path;
    fileName.value = extractFileName(path);
    await validateFile();
  }

  // ── Actions ──

  async function browseFile(): Promise<void> {
    // Non-Tauri fallback
    if (!isTauri()) {
      const path = promptForPath("Enter .tpx.json file path:");
      if (path) await selectFile(path);
      return;
    }

    try {
      const selected = await tauriDialogOpen({
        title: "Select TracePilot export file",
        filters: [{ name: "TracePilot Export", extensions: ["json"] }],
      });
      if (selected) {
        await selectFile(typeof selected === "string" ? selected : selected[0]);
      }
    } catch (e) {
      // Dialog failed — fall back to prompt
      logError("[useImportFlow] File dialog failed, falling back to prompt:", e);
      const path = promptForPath("Enter .tpx.json file path:");
      if (path) await selectFile(path);
    }
  }

  async function validateFile(): Promise<void> {
    if (!filePath.value) return;

    const token = validateGuard.start();
    step.value = "validating";
    error.value = null;
    preview.value = null;

    try {
      const result = await previewImport(filePath.value);

      // Guard against stale responses from rapid file selections
      if (!validateGuard.isValid(token)) return;

      preview.value = result;

      // Auto-select all sessions from the preview
      selectedSessions.value = result.sessions.map((s) => s.id);
      step.value = "review";
      logInfo(
        `[useImportFlow] Validated ${result.sessions.length} session(s) from ${fileName.value}`,
      );
    } catch (e) {
      if (!validateGuard.isValid(token)) return;
      const msg = toErrorMessage(e);
      error.value = msg;
      step.value = "select";
      logError("[useImportFlow] Validation failed:", msg);
    }
  }

  async function executeImport(): Promise<void> {
    if (!canImport.value) return;

    const token = importGuard.start();
    step.value = "importing";
    error.value = null;
    importProgress.value = 0;
    importedCount.value = 0;
    skippedCount.value = 0;
    importErrors.value = [];

    // Simulate progress while waiting for the backend
    clearProgressTimer();
    activeProgressTimer = setInterval(() => {
      if (importProgress.value < 90) {
        importProgress.value += Math.random() * 15;
        if (importProgress.value > 90) importProgress.value = 90;
      }
    }, 300);

    try {
      const result: ImportResult = await importSessions({
        filePath: filePath.value,
        conflictStrategy: conflictStrategy.value,
        sessionFilter: selectedSessions.value,
      });

      if (!importGuard.isValid(token)) return;
      clearProgressTimer();
      importProgress.value = 100;
      importedCount.value = result.importedCount;
      skippedCount.value = result.skippedCount;
      importErrors.value = result.warnings;
      step.value = "complete";

      logInfo(
        `[useImportFlow] Import complete: ${result.importedCount} imported, ${result.skippedCount} skipped`,
      );
    } catch (e) {
      if (!importGuard.isValid(token)) return;
      clearProgressTimer();
      const msg = toErrorMessage(e);
      error.value = msg;
      importProgress.value = 0;
      step.value = "review";
      logError("[useImportFlow] Import failed:", msg);
    }
  }

  function reset(): void {
    clearProgressTimer();
    validateGuard.invalidate();
    importGuard.invalidate();
    step.value = "select";
    filePath.value = "";
    fileName.value = "";
    preview.value = null;
    error.value = null;
    conflictStrategy.value = "skip";
    selectedSessions.value = [];
    importProgress.value = 0;
    importedCount.value = 0;
    skippedCount.value = 0;
    importErrors.value = [];
  }

  function toggleSession(sessionId: string): void {
    const idx = selectedSessions.value.indexOf(sessionId);
    if (idx === -1) {
      selectedSessions.value = [...selectedSessions.value, sessionId];
    } else {
      selectedSessions.value = selectedSessions.value.filter((id) => id !== sessionId);
    }
  }

  // ── Lifecycle cleanup ──
  // Prevent timer leaks when the consuming component unmounts mid-import.
  onBeforeUnmount(() => {
    clearProgressTimer();
    validateGuard.invalidate();
    importGuard.invalidate();
  });

  return {
    step,
    filePath,
    fileName,
    preview,
    error,
    conflictStrategy,
    selectedSessions,
    importProgress,
    importedCount,
    skippedCount,
    importErrors,
    hasErrors,
    canImport,
    browseFile,
    validateFile,
    executeImport,
    reset,
    toggleSession,
  };
}
