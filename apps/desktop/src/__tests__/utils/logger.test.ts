import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/plugin-log BEFORE importing the logger
const mockDebug = vi.fn().mockResolvedValue(undefined);
const mockInfo = vi.fn().mockResolvedValue(undefined);
const mockWarn = vi.fn().mockResolvedValue(undefined);
const mockError = vi.fn().mockResolvedValue(undefined);
const mockTrace = vi.fn().mockResolvedValue(undefined);
const mockAttachConsole = vi.fn().mockResolvedValue(() => {});

vi.mock('@tauri-apps/plugin-log', () => ({
  debug: mockDebug,
  info: mockInfo,
  warn: mockWarn,
  error: mockError,
  trace: mockTrace,
  attachConsole: mockAttachConsole,
}));

import { stringifyExtra } from '@/utils/logger';

describe('stringifyExtra', () => {
  it('returns string as-is', () => {
    expect(stringifyExtra('hello')).toBe('hello');
  });

  it('serializes Error with stack', () => {
    const err = new Error('test error');
    const result = stringifyExtra(err);
    expect(result).toContain('test error');
    // Stack trace should be present
    expect(result).toContain('Error: test error');
  });

  it('serializes Error without stack', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    expect(stringifyExtra(err)).toBe('no stack');
  });

  it('serializes objects as JSON', () => {
    const obj = { foo: 'bar', count: 42 };
    expect(stringifyExtra(obj)).toBe('{"foo":"bar","count":42}');
  });

  it('serializes numbers', () => {
    expect(stringifyExtra(42)).toBe('42');
  });

  it('serializes null', () => {
    expect(stringifyExtra(null)).toBe('null');
  });

  it('serializes undefined', () => {
    expect(stringifyExtra(undefined)).toBe('undefined');
  });

  it('handles circular references gracefully', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    // JSON.stringify will throw, should fall back to String()
    const result = stringifyExtra(obj);
    expect(typeof result).toBe('string');
  });
});

describe('logError / logWarn / logInfo / logDebug (non-Tauri)', () => {
  // In the test environment, isTauri is false because __TAURI_INTERNALS__
  // is not defined. The facade functions should call console.* but NOT
  // call the async backend logging functions.

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logError calls console.error with all arguments', async () => {
    // Dynamic import to get the non-Tauri version
    const { logError } = await import('@/utils/logger');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('test');
    logError('prefix:', err);
    expect(spy).toHaveBeenCalledWith('prefix:', err);
    spy.mockRestore();
  });

  it('logWarn calls console.warn with all arguments', async () => {
    const { logWarn } = await import('@/utils/logger');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn('[test] something went wrong', { detail: 1 });
    expect(spy).toHaveBeenCalledWith('[test] something went wrong', { detail: 1 });
    spy.mockRestore();
  });

  it('logInfo calls console.info', async () => {
    const { logInfo } = await import('@/utils/logger');
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logInfo('info message');
    expect(spy).toHaveBeenCalledWith('info message');
    spy.mockRestore();
  });

  it('logDebug calls console.debug', async () => {
    const { logDebug } = await import('@/utils/logger');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logDebug('debug message');
    expect(spy).toHaveBeenCalledWith('debug message');
    spy.mockRestore();
  });

  it('logError does not double-log in non-Tauri mode', async () => {
    const { logError } = await import('@/utils/logger');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('test message');
    // Should be called exactly once (facade call), not twice (facade + fallback)
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('logWarn does not double-log in non-Tauri mode', async () => {
    const { logWarn } = await import('@/utils/logger');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn('test message');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('facade function signatures', () => {
  it('logError and logWarn are assignable to the same variable type', async () => {
    const { logError, logWarn } = await import('@/utils/logger');
    // This tests that both can be used as a dynamic logFn (as in sessionDetail.ts)
    const logFn: (msg: string, ...extra: unknown[]) => void = logError;
    expect(typeof logFn).toBe('function');

    const logFn2: (msg: string, ...extra: unknown[]) => void = logWarn;
    expect(typeof logFn2).toBe('function');
  });
});
