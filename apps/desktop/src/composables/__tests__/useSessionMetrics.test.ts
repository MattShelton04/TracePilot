import { describe, it, expect, vi } from 'vitest';
import { wholesaleCost } from '../useSessionMetrics';
import type { ShutdownMetrics } from '@tracepilot/types';

describe('useSessionMetrics', () => {
  describe('wholesaleCost', () => {
    it('returns 0 if m is null', () => {
      expect(wholesaleCost(null, () => 0)).toBe(0);
    });

    it('returns 0 if m.modelMetrics is undefined', () => {
      const m: ShutdownMetrics = {};
      expect(wholesaleCost(m, () => 0)).toBe(0);
    });

    it('calculates total cost correctly across multiple models', () => {
      const m: ShutdownMetrics = {
        modelMetrics: {
          'model-a': {
            usage: { inputTokens: 100, cacheReadTokens: 50, outputTokens: 200 }
          },
          'model-b': {
            usage: { inputTokens: 300, cacheReadTokens: 0, outputTokens: 400 }
          }
        }
      };

      const computeFn = vi.fn();
      computeFn.mockImplementation((model, input, cache, output) => {
        if (model === 'model-a') return (input + cache + output) * 0.1;
        if (model === 'model-b') return (input + cache + output) * 0.2;
        return 0;
      });

      const cost = wholesaleCost(m, computeFn);

      expect(computeFn).toHaveBeenCalledTimes(2);
      expect(computeFn).toHaveBeenCalledWith('model-a', 100, 50, 200);
      expect(computeFn).toHaveBeenCalledWith('model-b', 300, 0, 400);

      // model-a: (100+50+200) * 0.1 = 35
      // model-b: (300+0+400) * 0.2 = 140
      // total: 175
      expect(cost).toBe(175);
    });

    it('handles missing usage gracefully', () => {
      const m: ShutdownMetrics = {
        modelMetrics: {
          'model-c': {} // usage is undefined
        }
      };

      const computeFn = vi.fn().mockReturnValue(10);
      const cost = wholesaleCost(m, computeFn);

      expect(computeFn).toHaveBeenCalledWith('model-c', 0, 0, 0);
      expect(cost).toBe(10);
    });

    it('handles computeWholesaleCost returning null', () => {
      const m: ShutdownMetrics = {
        modelMetrics: {
          'model-d': {
            usage: { inputTokens: 10 }
          }
        }
      };

      const computeFn = vi.fn().mockReturnValue(null);
      const cost = wholesaleCost(m, computeFn);

      expect(cost).toBe(0);
    });
  });
});
