import type {
  BenchmarkPreflight,
  BenchmarkProfile,
  CapturePreflight,
  CaptureProtocol,
  ContextCaptureSnapshot,
  ContextCaptureStorageStats,
  ContextCaptureSummary,
} from "@tracepilot/types";
import { invoke } from "./internal/core.js";
import { toRustOptional } from "./internal/optional.js";

export function contextCapturePreflight(sessionId: string): Promise<CapturePreflight> {
  return invoke("context_capture_preflight", { sessionId });
}

export function contextCaptureStart(request: {
  sessionId: string;
  protocol: CaptureProtocol;
  save: boolean;
  allowDegradedFidelity?: boolean;
}): Promise<ContextCaptureSnapshot> {
  return invoke("context_capture_start", {
    request: {
      ...request,
      allowDegradedFidelity: request.allowDegradedFidelity ?? false,
    },
  });
}

export function contextCaptureCancel(captureId?: string): Promise<boolean> {
  return invoke("context_capture_cancel", { captureId: toRustOptional(captureId) });
}

export function contextCaptureList(sessionId: string): Promise<ContextCaptureSummary[]> {
  return invoke("context_capture_list", { sessionId });
}

export function contextCaptureGet(
  sessionId: string,
  captureId: string,
): Promise<ContextCaptureSnapshot> {
  return invoke("context_capture_get", { sessionId, captureId });
}

export function contextCaptureDelete(sessionId: string, captureId: string): Promise<void> {
  return invoke("context_capture_delete", { sessionId, captureId });
}

export function contextCaptureDeleteAll(): Promise<number> {
  return invoke("context_capture_delete_all");
}

export function contextCaptureStorageStats(): Promise<ContextCaptureStorageStats> {
  return invoke("context_capture_storage_stats");
}

export function contextBenchmarkPreflight(): Promise<BenchmarkPreflight> {
  return invoke("context_benchmark_preflight");
}

export function contextBenchmarkStart(request: {
  profile: BenchmarkProfile;
  repositoryPath?: string | null;
  model: string;
  protocol: CaptureProtocol;
  save?: boolean;
}): Promise<ContextCaptureSnapshot> {
  return invoke("context_benchmark_start", {
    request: { ...request, save: request.save ?? true },
  });
}

export function contextBenchmarkList(): Promise<ContextCaptureSummary[]> {
  return invoke("context_benchmark_list");
}

export function contextBenchmarkGet(captureId: string): Promise<ContextCaptureSnapshot> {
  return invoke("context_benchmark_get", { captureId });
}

export function contextBenchmarkDelete(captureId: string): Promise<void> {
  return invoke("context_benchmark_delete", { captureId });
}
