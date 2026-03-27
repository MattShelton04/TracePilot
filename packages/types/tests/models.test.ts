import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getModelById, MODEL_REGISTRY } from '../src/models.js';

describe('getModelById', () => {
  test('returns the correct model for an exact match', () => {
    const knownModel = MODEL_REGISTRY[0];
    const model = getModelById(knownModel.id);
    assert.ok(model);
    assert.strictEqual(model.id, knownModel.id);
    assert.strictEqual(model, knownModel); // Should be the exact same object reference
  });

  test('returns the correct model for a case-insensitive match', () => {
    const knownModel = MODEL_REGISTRY[0];
    const upperCaseId = knownModel.id.toUpperCase();
    const model = getModelById(upperCaseId);
    assert.ok(model);
    assert.strictEqual(model.id, knownModel.id);
    assert.strictEqual(model, knownModel);
  });

  test('returns undefined for a missing model', () => {
    const model = getModelById('this-model-id-does-not-exist');
    assert.strictEqual(model, undefined);
  });
});
