import { describe, it, expect } from 'vitest';
import { totalTokens } from '../useSessionMetrics';
import type { ShutdownMetrics } from '@tracepilot/types';

describe('useSessionMetrics', () => {
  describe('totalTokens', () => {
    it('returns 0 when m is null', () => {
      expect(totalTokens(null)).toBe(0);
    });

    it('returns 0 when modelMetrics is missing', () => {
      const metrics: ShutdownMetrics = {};
      expect(totalTokens(metrics)).toBe(0);
    });

    it('returns 0 when modelMetrics is empty', () => {
      const metrics: ShutdownMetrics = { modelMetrics: {} };
      expect(totalTokens(metrics)).toBe(0);
    });

    it('returns total tokens for a single model', () => {
      const metrics: ShutdownMetrics = {
        modelMetrics: {
          'gpt-4': {
            usage: {
              inputTokens: 100,
              outputTokens: 50,
            },
          },
        },
      };
      expect(totalTokens(metrics)).toBe(150);
    });

    it('returns total tokens across multiple models', () => {
      const metrics: ShutdownMetrics = {
        modelMetrics: {
          'gpt-4': {
            usage: {
              inputTokens: 100,
              outputTokens: 50,
            },
          },
          'gpt-3.5-turbo': {
            usage: {
              inputTokens: 200,
              outputTokens: 75,
            },
          },
        },
      };
      expect(totalTokens(metrics)).toBe(425);
    });

    it('handles missing usage property', () => {
      const metrics: ShutdownMetrics = {
        modelMetrics: {
          'gpt-4': {},
        },
      };
      expect(totalTokens(metrics)).toBe(0);
    });

    it('handles missing inputTokens or outputTokens', () => {
      const metrics: ShutdownMetrics = {
        modelMetrics: {
          'model-a': {
            usage: {
              inputTokens: 100,
            },
          },
          'model-b': {
            usage: {
              outputTokens: 50,
            },
          },
        },
      };
      expect(totalTokens(metrics)).toBe(150);
    });
  });
});
