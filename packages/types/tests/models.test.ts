import { test, describe, expect } from 'vitest';
import { getModelById, MODEL_REGISTRY } from '../src/models.js';

describe('getModelById', () => {
  test('returns the correct model for an exact match', () => {
    const knownModel = MODEL_REGISTRY[0];
    const model = getModelById(knownModel.id);
    expect(model).toBeDefined();
    expect(model?.id).toBe(knownModel.id);
    expect(model).toBe(knownModel); // Should be the exact same object reference
  });

  test('returns the correct model for a case-insensitive match', () => {
    const knownModel = MODEL_REGISTRY[0];
    const upperCaseId = knownModel.id.toUpperCase();
    const model = getModelById(upperCaseId);
    expect(model).toBeDefined();
    expect(model?.id).toBe(knownModel.id);
    expect(model).toBe(knownModel);
  });

  test('returns undefined for a missing model', () => {
    const model = getModelById('this-model-id-does-not-exist');
    expect(model).toBeUndefined();
  });
});
