import type { ModelInfo, SessionTemplate, SystemDependencies } from '@tracepilot/types';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLauncherStore } from '../../stores/launcher';

// Mock the client module
const mockLaunchSession = vi.fn();
const mockGetAvailableModels = vi.fn();
const mockListSessionTemplates = vi.fn();
const mockSaveSessionTemplate = vi.fn();
const mockDeleteSessionTemplate = vi.fn();
const mockRestoreDefaultTemplates = vi.fn();
const mockIncrementTemplateUsage = vi.fn();
const mockCheckSystemDeps = vi.fn();

vi.mock('@tracepilot/client', () => ({
  launchSession: (...args: unknown[]) => mockLaunchSession(...args),
  getAvailableModels: (...args: unknown[]) => mockGetAvailableModels(...args),
  listSessionTemplates: (...args: unknown[]) => mockListSessionTemplates(...args),
  saveSessionTemplate: (...args: unknown[]) => mockSaveSessionTemplate(...args),
  deleteSessionTemplate: (...args: unknown[]) => mockDeleteSessionTemplate(...args),
  restoreDefaultTemplates: (...args: unknown[]) => mockRestoreDefaultTemplates(...args),
  incrementTemplateUsage: (...args: unknown[]) => mockIncrementTemplateUsage(...args),
  checkSystemDeps: (...args: unknown[]) => mockCheckSystemDeps(...args),
}));

const MOCK_TEMPLATE: SessionTemplate = {
  id: 'default-multi-agent-review',
  name: 'Multi Agent Code Review',
  description: 'Comprehensive code review using multiple AI models',
  icon: '🔍',
  category: 'Quality',
  config: {
    repoPath: '',
    headless: false,
    envVars: {},
    createWorktree: false,
    autoApprove: false,
    model: 'claude-opus-4.6',
    reasoningEffort: 'high',
    prompt:
      'Spin up opus 4.6, GPT 5.4, Codex 5.3, and Gemini subagents to do a comprehensive code review of the changes on this branch (git diff). Consolidate and validate their feedback, and provide a summary.',
  },
  tags: ['review', 'multi-agent', 'premium'],
  createdAt: '2025-01-01T00:00:00Z',
  usageCount: 0,
};

const MOCK_TEMPLATE_WRITE_TESTS: SessionTemplate = {
  id: 'default-write-tests',
  name: 'Write Tests',
  description: 'Generate comprehensive test coverage for recent changes',
  icon: '🧪',
  category: 'Quality',
  config: {
    repoPath: '',
    headless: false,
    envVars: {},
    createWorktree: false,
    autoApprove: false,
    model: 'claude-sonnet-4.6',
    reasoningEffort: 'high',
  },
  tags: ['testing', 'coverage'],
  createdAt: '2025-01-01T00:00:00Z',
  usageCount: 0,
};

const MOCK_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', tier: 'premium' },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tier: 'standard' },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', tier: 'fast' },
];

const MOCK_DEPS: SystemDependencies = {
  gitAvailable: true,
  gitVersion: '2.45.0',
  copilotAvailable: true,
  copilotVersion: '1.0.9',
  copilotHomeExists: true,
};

describe('useLauncherStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockLaunchSession.mockReset();
    mockGetAvailableModels.mockReset();
    mockListSessionTemplates.mockReset();
    mockSaveSessionTemplate.mockReset();
    mockDeleteSessionTemplate.mockReset();
    mockRestoreDefaultTemplates.mockReset();
    mockIncrementTemplateUsage.mockReset();
    mockCheckSystemDeps.mockReset();
  });

  it('initializes with empty state', () => {
    const store = useLauncherStore();
    expect(store.models).toEqual([]);
    expect(store.templates).toEqual([]);
    expect(store.recentLaunches).toEqual([]);
    expect(store.systemDeps).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  describe('initialize', () => {
    it('loads models, templates, and system deps', async () => {
      mockCheckSystemDeps.mockResolvedValue(MOCK_DEPS);
      mockGetAvailableModels.mockResolvedValue(MOCK_MODELS);
      mockListSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.systemDeps).toEqual(MOCK_DEPS);
      expect(store.models).toEqual(MOCK_MODELS);
      expect(store.templates).toHaveLength(2);
      expect(store.templates[0].icon).toBe('🔍');
      expect(store.templates[1].icon).toBe('🧪');
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('sets error when some requests fail', async () => {
      mockCheckSystemDeps.mockResolvedValue(MOCK_DEPS);
      mockGetAvailableModels.mockRejectedValue(new Error('Network error'));
      mockListSessionTemplates.mockResolvedValue([MOCK_TEMPLATE]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.systemDeps).toEqual(MOCK_DEPS);
      expect(store.models).toEqual([]); // failed
      expect(store.templates).toHaveLength(1); // succeeded
      expect(store.error).toContain('Network error');
    });
  });

  describe('isReady', () => {
    it('returns false when system deps not loaded', () => {
      const store = useLauncherStore();
      expect(store.isReady).toBeFalsy();
    });

    it('returns true when git and copilot available', async () => {
      mockCheckSystemDeps.mockResolvedValue(MOCK_DEPS);
      mockGetAvailableModels.mockResolvedValue([]);
      mockListSessionTemplates.mockResolvedValue([]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.isReady).toBe(true);
    });

    it('returns false when git not available', async () => {
      mockCheckSystemDeps.mockResolvedValue({ ...MOCK_DEPS, gitAvailable: false });
      mockGetAvailableModels.mockResolvedValue([]);
      mockListSessionTemplates.mockResolvedValue([]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.isReady).toBeFalsy();
    });
  });

  describe('modelsByTier', () => {
    it('groups models by tier', async () => {
      mockCheckSystemDeps.mockResolvedValue(MOCK_DEPS);
      mockGetAvailableModels.mockResolvedValue(MOCK_MODELS);
      mockListSessionTemplates.mockResolvedValue([]);

      const store = useLauncherStore();
      await store.initialize();

      expect(store.modelsByTier).toEqual({
        premium: [{ id: 'claude-opus-4.6', name: 'Claude Opus 4.6', tier: 'premium' }],
        standard: [{ id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tier: 'standard' }],
        fast: [{ id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', tier: 'fast' }],
      });
    });
  });

  describe('templates', () => {
    it('default templates have icon field', async () => {
      mockCheckSystemDeps.mockResolvedValue(MOCK_DEPS);
      mockGetAvailableModels.mockResolvedValue([]);
      mockListSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS]);

      const store = useLauncherStore();
      await store.initialize();

      for (const tpl of store.templates) {
        expect(tpl.icon).toBeDefined();
        expect(typeof tpl.icon).toBe('string');
      }
    });

    it('multi-agent review template has correct config', async () => {
      mockCheckSystemDeps.mockResolvedValue(MOCK_DEPS);
      mockGetAvailableModels.mockResolvedValue([]);
      mockListSessionTemplates.mockResolvedValue([MOCK_TEMPLATE]);

      const store = useLauncherStore();
      await store.initialize();

      const tpl = store.templates.find((t) => t.id === 'default-multi-agent-review');
      expect(tpl).toBeDefined();
      expect(tpl!.config.model).toBe('claude-opus-4.6');
      expect(tpl!.config.reasoningEffort).toBe('high');
      expect(tpl!.config.prompt).toContain('Spin up opus 4.6');
      expect(tpl!.icon).toBe('🔍');
    });

    it('write tests template has correct config', async () => {
      mockCheckSystemDeps.mockResolvedValue(MOCK_DEPS);
      mockGetAvailableModels.mockResolvedValue([]);
      mockListSessionTemplates.mockResolvedValue([MOCK_TEMPLATE_WRITE_TESTS]);

      const store = useLauncherStore();
      await store.initialize();

      const tpl = store.templates.find((t) => t.id === 'default-write-tests');
      expect(tpl).toBeDefined();
      expect(tpl!.config.model).toBe('claude-sonnet-4.6');
      expect(tpl!.config.reasoningEffort).toBe('high');
      expect(tpl!.config.createWorktree).toBe(false);
      expect(tpl!.config.autoApprove).toBe(false);
      expect(tpl!.icon).toBe('🧪');
    });
  });

  describe('saveTemplate', () => {
    it('saves template and refreshes list', async () => {
      const savedTemplate: SessionTemplate = {
        ...MOCK_TEMPLATE,
        id: 'user-custom-1',
        name: 'Custom Template',
        icon: '⭐',
      };

      mockSaveSessionTemplate.mockResolvedValue(undefined);
      mockListSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, savedTemplate]);

      const store = useLauncherStore();
      const result = await store.saveTemplate(savedTemplate);

      expect(result).toBe(true);
      expect(mockSaveSessionTemplate).toHaveBeenCalledWith(savedTemplate);
      expect(mockListSessionTemplates).toHaveBeenCalled();
      expect(store.templates).toHaveLength(2);
    });

    it('returns false and sets error on failure', async () => {
      mockSaveSessionTemplate.mockRejectedValue(new Error('Save failed'));

      const store = useLauncherStore();
      const result = await store.saveTemplate(MOCK_TEMPLATE);

      expect(result).toBe(false);
      expect(store.error).toContain('Save failed');
    });
  });

  describe('deleteTemplate', () => {
    it('removes template from store', async () => {
      mockCheckSystemDeps.mockResolvedValue(MOCK_DEPS);
      mockGetAvailableModels.mockResolvedValue([]);
      mockListSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS]);
      mockDeleteSessionTemplate.mockResolvedValue(undefined);

      const store = useLauncherStore();
      await store.initialize();
      expect(store.templates).toHaveLength(2);

      const result = await store.deleteTemplate('default-write-tests');
      expect(result).toBe(true);
      expect(mockDeleteSessionTemplate).toHaveBeenCalledWith('default-write-tests');
      expect(store.templates).toHaveLength(1);
      expect(store.templates[0].id).toBe('default-multi-agent-review');
    });

    it('can delete default templates (dismiss)', async () => {
      mockCheckSystemDeps.mockResolvedValue(MOCK_DEPS);
      mockGetAvailableModels.mockResolvedValue([]);
      mockListSessionTemplates.mockResolvedValue([MOCK_TEMPLATE]);
      mockDeleteSessionTemplate.mockResolvedValue(undefined);

      const store = useLauncherStore();
      await store.initialize();

      const result = await store.deleteTemplate('default-multi-agent-review');
      expect(result).toBe(true);
      expect(store.templates).toHaveLength(0);
    });

    it('returns false and sets error on failure', async () => {
      mockDeleteSessionTemplate.mockRejectedValue(new Error('Delete failed'));

      const store = useLauncherStore();
      store.templates = [MOCK_TEMPLATE];
      const result = await store.deleteTemplate('default-multi-agent-review');

      expect(result).toBe(false);
      expect(store.error).toContain('Delete failed');
    });
  });

  describe('launch', () => {
    it('launches session and tracks in recent launches', async () => {
      const mockSession = {
        pid: 12345,
        command: 'copilot --model=claude-opus-4.6',
        launchedAt: '2025-01-01T00:00:00Z',
      };
      mockLaunchSession.mockResolvedValue(mockSession);

      const store = useLauncherStore();
      const result = await store.launch({
        repoPath: 'C:\\git\\test',
        headless: false,
        envVars: {},
        createWorktree: false,
        autoApprove: false,
      });

      expect(result).toEqual(mockSession);
      expect(store.recentLaunches).toHaveLength(1);
      expect(store.recentLaunches[0].pid).toBe(12345);
    });

    it('caps recent launches at 10', async () => {
      const store = useLauncherStore();
      store.recentLaunches = Array.from({ length: 10 }, (_, i) => ({
        pid: i,
        command: `cmd-${i}`,
        launchedAt: '2025-01-01T00:00:00Z',
      }));

      const mockSession = {
        pid: 99,
        command: 'copilot',
        launchedAt: '2025-01-01T00:00:00Z',
      };
      mockLaunchSession.mockResolvedValue(mockSession);

      await store.launch({
        repoPath: 'C:\\git\\test',
        headless: false,
        envVars: {},
        createWorktree: false,
        autoApprove: false,
      });

      expect(store.recentLaunches).toHaveLength(10);
      expect(store.recentLaunches[0].pid).toBe(99);
    });

    it('returns null and sets error on failure', async () => {
      mockLaunchSession.mockRejectedValue(new Error('Launch failed'));

      const store = useLauncherStore();
      const result = await store.launch({
        repoPath: 'C:\\git\\test',
        headless: false,
        envVars: {},
        createWorktree: false,
        autoApprove: false,
      });

      expect(result).toBeNull();
      expect(store.error).toContain('Launch failed');
    });
  });

  describe('restoreDefaults', () => {
    it('calls restore API and refreshes templates', async () => {
      mockRestoreDefaultTemplates.mockResolvedValue(undefined);
      mockListSessionTemplates.mockResolvedValue([MOCK_TEMPLATE, MOCK_TEMPLATE_WRITE_TESTS]);

      const store = useLauncherStore();
      store.templates = []; // all dismissed

      const result = await store.restoreDefaults();

      expect(result).toBe(true);
      expect(mockRestoreDefaultTemplates).toHaveBeenCalled();
      expect(mockListSessionTemplates).toHaveBeenCalled();
      expect(store.templates).toHaveLength(2);
    });

    it('returns false and sets error on failure', async () => {
      mockRestoreDefaultTemplates.mockRejectedValue(new Error('Restore failed'));

      const store = useLauncherStore();
      const result = await store.restoreDefaults();

      expect(result).toBe(false);
      expect(store.error).toContain('Restore failed');
    });
  });

  describe('incrementUsage', () => {
    it('increments usage count optimistically', async () => {
      mockIncrementTemplateUsage.mockResolvedValue(undefined);

      const store = useLauncherStore();
      store.templates = [{ ...MOCK_TEMPLATE, usageCount: 3 }];

      await store.incrementUsage('default-multi-agent-review');

      expect(mockIncrementTemplateUsage).toHaveBeenCalledWith('default-multi-agent-review');
      expect(store.templates[0].usageCount).toBe(4);
    });

    it('does not surface errors for usage tracking', async () => {
      mockIncrementTemplateUsage.mockRejectedValue(new Error('Tracking failed'));

      const store = useLauncherStore();
      store.templates = [{ ...MOCK_TEMPLATE, usageCount: 0 }];

      await store.incrementUsage('default-multi-agent-review');

      // Error should NOT be set — usage tracking is non-critical
      expect(store.error).toBeNull();
    });
  });
});
