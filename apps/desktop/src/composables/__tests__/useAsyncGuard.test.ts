import { describe, it, expect } from 'vitest';
import { useAsyncGuard } from '../useAsyncGuard';

describe('useAsyncGuard', () => {
  describe('basic functionality', () => {
    it('start() returns a token', () => {
      const guard = useAsyncGuard();
      const token = guard.start();
      expect(typeof token).toBe('number');
      expect(token).toBeGreaterThan(0);
    });

    it('isValid() returns true for current token', () => {
      const guard = useAsyncGuard();
      const token = guard.start();
      expect(guard.isValid(token)).toBe(true);
    });

    it('isValid() returns false for old token after new start()', () => {
      const guard = useAsyncGuard();
      const token1 = guard.start();
      const token2 = guard.start();

      expect(guard.isValid(token1)).toBe(false);
      expect(guard.isValid(token2)).toBe(true);
    });

    it('successive tokens have incrementing values', () => {
      const guard = useAsyncGuard();
      const token1 = guard.start();
      const token2 = guard.start();
      const token3 = guard.start();

      expect(token2).toBe(token1 + 1);
      expect(token3).toBe(token2 + 1);
    });
  });

  describe('multiple tokens', () => {
    it('only the last token is valid', () => {
      const guard = useAsyncGuard();
      const token1 = guard.start();
      const token2 = guard.start();
      const token3 = guard.start();

      expect(guard.isValid(token1)).toBe(false);
      expect(guard.isValid(token2)).toBe(false);
      expect(guard.isValid(token3)).toBe(true);
    });

    it('checking same token multiple times returns consistent result', () => {
      const guard = useAsyncGuard();
      const token = guard.start();

      expect(guard.isValid(token)).toBe(true);
      expect(guard.isValid(token)).toBe(true);
      expect(guard.isValid(token)).toBe(true);
    });
  });

  describe('invalidate()', () => {
    it('invalidates current token', () => {
      const guard = useAsyncGuard();
      const token = guard.start();

      expect(guard.isValid(token)).toBe(true);
      guard.invalidate();
      expect(guard.isValid(token)).toBe(false);
    });

    it('allows new tokens after invalidation', () => {
      const guard = useAsyncGuard();
      const oldToken = guard.start();

      guard.invalidate();
      expect(guard.isValid(oldToken)).toBe(false);

      const newToken = guard.start();
      expect(guard.isValid(newToken)).toBe(true);
    });

    it('can be called multiple times safely', () => {
      const guard = useAsyncGuard();
      const token = guard.start();

      guard.invalidate();
      guard.invalidate();
      guard.invalidate();

      expect(guard.isValid(token)).toBe(false);

      const newToken = guard.start();
      expect(guard.isValid(newToken)).toBe(true);
    });
  });

  describe('race condition simulation', () => {
    it('prevents late-completing first request from overwriting second', async () => {
      const guard = useAsyncGuard();
      let state = { data: null as string | null };

      // Simulate async operations with explicit timing control
      let resolveFirst: (value: string) => void;
      let resolveSecond: (value: string) => void;

      const firstRequest = new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });
      const secondRequest = new Promise<string>((resolve) => {
        resolveSecond = resolve;
      });

      // Start first request
      const token1 = guard.start();
      const promise1 = firstRequest.then((data) => {
        if (guard.isValid(token1)) state.data = data;
      });

      // Start second request (invalidates first)
      const token2 = guard.start();
      const promise2 = secondRequest.then((data) => {
        if (guard.isValid(token2)) state.data = data;
      });

      // Resolve second request FIRST
      resolveSecond!('second');
      await promise2;
      expect(state.data).toBe('second');

      // Resolve first request LATER (should be ignored)
      resolveFirst!('first');
      await promise1;
      expect(state.data).toBe('second'); // Should NOT change to 'first'
    });

    it('handles three overlapping requests with mixed completion order', async () => {
      const guard = useAsyncGuard();
      let state = { data: null as string | null };

      const resolvers: Array<(value: string) => void> = [];
      const requests = Array(3)
        .fill(null)
        .map(
          (_, i) =>
            new Promise<string>((resolve) => {
              resolvers.push(resolve);
            }),
        );

      // Start requests in order 1, 2, 3
      const tokens = requests.map((req, i) => {
        const token = guard.start();
        req.then((data) => {
          if (guard.isValid(token)) state.data = data;
        });
        return token;
      });

      // Complete in order: 2, 3, 1
      resolvers[1]('second'); // Should be ignored (not latest)
      await new Promise((r) => setTimeout(r, 10));
      expect(state.data).toBeNull();

      resolvers[2]('third'); // Should succeed (is latest)
      await new Promise((r) => setTimeout(r, 10));
      expect(state.data).toBe('third');

      resolvers[0]('first'); // Should be ignored (old)
      await new Promise((r) => setTimeout(r, 10));
      expect(state.data).toBe('third'); // Should remain 'third'
    });

    it('guards work correctly across microtask boundaries', async () => {
      const guard = useAsyncGuard();
      let state = { value: 0 };

      const token1 = guard.start();

      // Microtask (Promise)
      Promise.resolve().then(() => {
        if (guard.isValid(token1)) state.value = 1;
      });

      // Immediately invalidate
      const token2 = guard.start();

      // Another microtask
      Promise.resolve().then(() => {
        if (guard.isValid(token2)) state.value = 2;
      });

      await new Promise((r) => setTimeout(r, 0));
      expect(state.value).toBe(2); // Only second update should apply
    });

    it('guards work correctly with setTimeout macrotasks', async () => {
      const guard = useAsyncGuard();
      let state = { value: 0 };

      const token1 = guard.start();

      setTimeout(() => {
        if (guard.isValid(token1)) state.value = 1;
      }, 50);

      const token2 = guard.start();

      setTimeout(() => {
        if (guard.isValid(token2)) state.value = 2;
      }, 10);

      await new Promise((r) => setTimeout(r, 100));
      expect(state.value).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('handles generation counter with many operations', () => {
      const guard = useAsyncGuard();

      // Simulate many operations
      for (let i = 0; i < 1000; i++) {
        guard.start();
      }

      const token = guard.start();
      expect(guard.isValid(token)).toBe(true);
    });

    it('tokens from different guard instances do not interfere', () => {
      const guard1 = useAsyncGuard();
      const guard2 = useAsyncGuard();

      const token1 = guard1.start();
      const token2 = guard2.start();

      expect(guard1.isValid(token1)).toBe(true);
      expect(guard2.isValid(token2)).toBe(true);

      // Start new operation in guard1
      guard1.start();

      // guard1's old token is invalid, guard2's token still valid
      expect(guard1.isValid(token1)).toBe(false);
      expect(guard2.isValid(token2)).toBe(true);
    });

    it('guard methods never throw exceptions', () => {
      const guard = useAsyncGuard();

      // These should never throw
      expect(() => guard.start()).not.toThrow();
      expect(() => guard.invalidate()).not.toThrow();

      const token = guard.start();
      expect(() => guard.isValid(token)).not.toThrow();
    });

    it('isValid handles invalid token values gracefully', () => {
      const guard = useAsyncGuard();
      guard.start(); // Generation is now 1

      // Test with tokens that don't match
      expect(guard.isValid(0)).toBe(false);
      expect(guard.isValid(999)).toBe(false);
      expect(guard.isValid(-1)).toBe(false);
    });
  });

  describe('error handling patterns', () => {
    it('token check in catch block prevents stale error display', async () => {
      const guard = useAsyncGuard();
      let errorState = { error: null as string | null };

      const token1 = guard.start();
      const promise1 = Promise.reject('error-1').catch((e) => {
        if (guard.isValid(token1)) errorState.error = e;
      });

      const token2 = guard.start();

      await promise1;
      expect(errorState.error).toBeNull(); // First error should be ignored
    });

    it('token check in finally block prevents stale cleanup', async () => {
      const guard = useAsyncGuard();
      let loadingState = { loading: false };

      const token1 = guard.start();
      loadingState.loading = true;

      const promise1 = new Promise<void>((resolve) => setTimeout(resolve, 50))
        .then(() => {
          // Operation completes
        })
        .finally(() => {
          if (guard.isValid(token1)) loadingState.loading = false;
        });

      // Start new operation immediately
      const token2 = guard.start();

      await promise1;
      // First operation's finally block should NOT clear loading (stale)
      expect(loadingState.loading).toBe(true);

      // Second operation can clear loading
      if (guard.isValid(token2)) loadingState.loading = false;
      expect(loadingState.loading).toBe(false);
    });
  });

  describe('performance', () => {
    it('guard operations complete in reasonable time', () => {
      const guard = useAsyncGuard();
      const iterations = 10000;

      const startTime = performance.now();
      for (let i = 0; i < iterations; i++) {
        const token = guard.start();
        guard.isValid(token);
      }
      const duration = performance.now() - startTime;

      // Should be very fast (< 100ms for 10k operations)
      expect(duration).toBeLessThan(100);
    });
  });

  describe('development debug helper', () => {
    it('provides debug info in development', () => {
      const guard = useAsyncGuard();

      if (import.meta.env.DEV && guard._debug) {
        const debug1 = guard._debug();
        expect(debug1.generation).toBe(0);

        guard.start();
        const debug2 = guard._debug();
        expect(debug2.generation).toBe(1);

        guard.start();
        guard.start();
        const debug3 = guard._debug();
        expect(debug3.generation).toBe(3);
      }
    });
  });
});
