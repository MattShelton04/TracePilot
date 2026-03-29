import { describe, expect, it } from 'vitest';
import { aggregateSettledErrors } from '../../utils/settleErrors';

/** Helper: create a fulfilled PromiseSettledResult. */
function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: 'fulfilled', value };
}

/** Helper: create a rejected PromiseSettledResult. */
function rejected(reason: unknown): PromiseRejectedResult {
  return { status: 'rejected', reason };
}

describe('aggregateSettledErrors', () => {
  it('returns null when all promises fulfilled', () => {
    const results = [fulfilled('a'), fulfilled(42), fulfilled(null)];
    expect(aggregateSettledErrors(results)).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(aggregateSettledErrors([])).toBeNull();
  });

  it('returns single error message for one rejection', () => {
    const results = [fulfilled('ok'), rejected(new Error('Network error'))];
    expect(aggregateSettledErrors(results)).toBe('Network error');
  });

  it('joins multiple error messages with "; "', () => {
    const results = [
      rejected(new Error('Fetch failed')),
      fulfilled('ok'),
      rejected(new Error('Timeout')),
    ];
    expect(aggregateSettledErrors(results)).toBe('Fetch failed; Timeout');
  });

  it('handles all-rejected results', () => {
    const results = [rejected(new Error('A')), rejected(new Error('B')), rejected(new Error('C'))];
    expect(aggregateSettledErrors(results)).toBe('A; B; C');
  });

  it('handles string rejection reasons', () => {
    const results = [rejected('plain string error')];
    expect(aggregateSettledErrors(results)).toBe('plain string error');
  });

  it('handles object rejection reasons with message property', () => {
    const results = [rejected({ message: 'object error' })];
    expect(aggregateSettledErrors(results)).toBe('object error');
  });

  it('handles null rejection reason', () => {
    const results = [rejected(null)];
    expect(aggregateSettledErrors(results)).toBe('Unknown error');
  });

  it('handles undefined rejection reason', () => {
    const results = [rejected(undefined)];
    expect(aggregateSettledErrors(results)).toBe('Unknown error');
  });

  it('handles numeric rejection reason', () => {
    const results = [rejected(404)];
    expect(aggregateSettledErrors(results)).toBe('404');
  });

  it('preserves order of errors from input array', () => {
    const results = [
      fulfilled('ok'),
      rejected(new Error('second')),
      fulfilled('ok'),
      rejected(new Error('fourth')),
      rejected(new Error('fifth')),
    ];
    expect(aggregateSettledErrors(results)).toBe('second; fourth; fifth');
  });
});
