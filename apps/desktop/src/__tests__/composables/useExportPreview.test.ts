import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import type { ExportFormat, SectionId, ExportPreviewResult, ContentDetailOptions, RedactionOptions } from '@tracepilot/types';

// ── Mocks ──────────────────────────────────────────────────────
vi.mock('@tracepilot/client', async () => {
  const { createClientMock } = await import('../mocks/client');
  return createClientMock({
    previewExport: vi.fn(),
  });
});

vi.mock('@/utils/logger', () => ({
  logError: vi.fn(),
}));

// Mock onUnmounted since we're outside component context
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue');
  return {
    ...actual,
    onUnmounted: vi.fn((cb: () => void) => {
      // Store callback for manual invocation in tests
      (globalThis as Record<string, unknown>).__unmountCallback = cb;
    }),
  };
});

import { previewExport } from '@tracepilot/client';
import { useExportPreview } from '../../composables/useExportPreview';

const mockPreviewExport = vi.mocked(previewExport);

// ── Helpers ────────────────────────────────────────────────────

function makePreviewResult(content = '# Preview'): ExportPreviewResult {
  return {
    content,
    format: 'markdown',
    estimatedSizeBytes: content.length,
    sectionCount: 2,
  };
}

function createRefs() {
  return {
    sessionId: ref(''),
    format: ref<ExportFormat>('json'),
    sections: ref<SectionId[]>(['conversation', 'todos']),
    contentDetail: ref<ContentDetailOptions>({
      includeSubagentInternals: true,
      includeToolDetails: true,
      includeFullToolResults: false,
    }),
    redaction: ref<RedactionOptions>({
      anonymizePaths: false,
      stripSecrets: false,
      stripPii: false,
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useExportPreview', () => {
  // ── Initial State ──────────────────────────────────────────

  it('starts with null preview, not loading, no error', () => {
    const refs = createRefs();
    const { preview, loading, error } = useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
    );

    expect(preview.value).toBeNull();
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  // ── Fetch Behavior ─────────────────────────────────────────

  it('does not fetch when sessionId is empty', async () => {
    const refs = createRefs();
    const { preview, error } = useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
    );

    // Trigger the watcher
    refs.sessionId.value = '';
    await nextTick();
    vi.advanceTimersByTime(500);

    expect(mockPreviewExport).not.toHaveBeenCalled();
    expect(preview.value).toBeNull();
    expect(error.value).toBeNull();
  });

  it('fetches preview after debounce when sessionId is set', async () => {
    const refs = createRefs();
    mockPreviewExport.mockResolvedValue(makePreviewResult('# Hello'));

    useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
    );

    refs.sessionId.value = 'sess-1';
    await nextTick();

    // Before debounce fires
    expect(mockPreviewExport).not.toHaveBeenCalled();

    // After debounce (400ms)
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();

    expect(mockPreviewExport).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      format: 'json',
      sections: ['conversation', 'todos'],
      contentDetail: undefined,
      redaction: undefined,
    });
  });

  it('passes contentDetail and redaction when provided', async () => {
    const refs = createRefs();
    mockPreviewExport.mockResolvedValue(makePreviewResult());

    useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
      refs.contentDetail,
      refs.redaction,
    );

    refs.sessionId.value = 'sess-1';
    await nextTick();
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();

    expect(mockPreviewExport).toHaveBeenCalledWith(
      expect.objectContaining({
        contentDetail: refs.contentDetail.value,
        redaction: refs.redaction.value,
      }),
    );
  });

  // ── Error Handling ─────────────────────────────────────────

  it('sets error state on fetch failure', async () => {
    const refs = createRefs();
    mockPreviewExport.mockRejectedValue(new Error('Network error'));

    const { error, preview, loading } = useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
    );

    refs.sessionId.value = 'sess-1';
    await nextTick();
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();

    expect(error.value).toBe('Network error');
    expect(preview.value).toBeNull();
    expect(loading.value).toBe(false);
  });

  it('handles non-Error rejection', async () => {
    const refs = createRefs();
    mockPreviewExport.mockRejectedValue('string error');

    const { error } = useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
    );

    refs.sessionId.value = 'sess-1';
    await nextTick();
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();

    expect(error.value).toBe('string error');
  });

  // ── Stale Response Handling ────────────────────────────────

  it('discards stale responses when inputs change rapidly', async () => {
    const refs = createRefs();
    let resolveFirst!: (v: ExportPreviewResult) => void;
    let resolveSecond!: (v: ExportPreviewResult) => void;

    mockPreviewExport
      .mockReturnValueOnce(
        new Promise<ExportPreviewResult>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<ExportPreviewResult>((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const { preview } = useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
    );

    // First change
    refs.sessionId.value = 'sess-1';
    await nextTick();
    vi.advanceTimersByTime(400);
    await nextTick();

    // Second change before first resolves
    refs.format.value = 'markdown';
    await nextTick();
    vi.advanceTimersByTime(400);
    await nextTick();

    // Resolve second first
    resolveSecond(makePreviewResult('Second'));
    await vi.runAllTimersAsync();

    // Resolve stale first
    resolveFirst(makePreviewResult('First'));
    await vi.runAllTimersAsync();

    // Only the latest result should be used
    expect(preview.value?.content).toBe('Second');
  });

  // ── Reactivity to Detail/Redaction Changes ──────────────────

  it('re-fetches when contentDetail changes', async () => {
    const refs = createRefs();
    mockPreviewExport.mockResolvedValue(makePreviewResult('Initial'));

    useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
      refs.contentDetail,
      refs.redaction,
    );

    // Trigger initial fetch by changing sessionId after composable is created
    refs.sessionId.value = 'sess-1';
    await nextTick();
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();
    expect(mockPreviewExport).toHaveBeenCalledTimes(1);

    // Change contentDetail
    mockPreviewExport.mockResolvedValue(makePreviewResult('Updated'));
    refs.contentDetail.value = { ...refs.contentDetail.value, includeFullToolResults: true };
    await nextTick();
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();

    expect(mockPreviewExport).toHaveBeenCalledTimes(2);
    expect(mockPreviewExport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contentDetail: expect.objectContaining({ includeFullToolResults: true }),
      }),
    );
  });

  it('re-fetches when redaction changes', async () => {
    const refs = createRefs();
    mockPreviewExport.mockResolvedValue(makePreviewResult('Initial'));

    useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
      refs.contentDetail,
      refs.redaction,
    );

    // Trigger initial fetch
    refs.sessionId.value = 'sess-1';
    await nextTick();
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();

    // Change redaction
    refs.redaction.value = { ...refs.redaction.value, stripSecrets: true };
    await nextTick();
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();

    expect(mockPreviewExport).toHaveBeenCalledTimes(2);
    expect(mockPreviewExport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        redaction: expect.objectContaining({ stripSecrets: true }),
      }),
    );
  });

  // ── Manual Refresh ─────────────────────────────────────────

  it('refresh() fetches immediately without debounce', async () => {
    const refs = createRefs();
    refs.sessionId.value = 'sess-1';
    mockPreviewExport.mockResolvedValue(makePreviewResult('Refreshed'));

    const { refresh, preview } = useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
    );

    await refresh();

    expect(mockPreviewExport).toHaveBeenCalled();
    expect(preview.value?.content).toBe('Refreshed');
  });

  it('refresh() clears preview when sessionId is empty', async () => {
    const refs = createRefs();
    mockPreviewExport.mockResolvedValue(makePreviewResult('Data'));

    const { refresh, preview, error } = useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
    );

    // Should clear, not fetch
    await refresh();
    expect(preview.value).toBeNull();
    expect(error.value).toBeNull();
    expect(mockPreviewExport).not.toHaveBeenCalled();
  });

  // ── Unmount Cleanup ────────────────────────────────────────

  it('invalidates in-flight requests on unmount', async () => {
    const refs = createRefs();
    let resolvePreview!: (v: ExportPreviewResult) => void;
    mockPreviewExport.mockReturnValue(
      new Promise<ExportPreviewResult>((resolve) => {
        resolvePreview = resolve;
      }),
    );

    const { preview } = useExportPreview(
      refs.sessionId,
      refs.format,
      refs.sections,
    );

    // Start a fetch
    refs.sessionId.value = 'sess-1';
    await nextTick();
    vi.advanceTimersByTime(400);
    await nextTick();

    // Simulate unmount
    const unmountCb = (globalThis as Record<string, unknown>).__unmountCallback as () => void;
    if (unmountCb) unmountCb();

    // Resolve the in-flight request
    resolvePreview(makePreviewResult('Stale'));
    await vi.runAllTimersAsync();

    // Preview should not be updated after unmount
    expect(preview.value).toBeNull();
  });
});
