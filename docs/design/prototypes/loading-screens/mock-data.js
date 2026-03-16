/**
 * TracePilot Loading Screen — Mock Data & Simulation Engine
 * 
 * Provides simulated indexing events and stats for prototype demos.
 * In production, these would come from Tauri IPC events.
 */

// === TracePilot Logo SVG (inline) ===
const TRACEPILOT_LOGO_SVG = `
<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M50 5L93.3 27.5V72.5L50 95L6.7 72.5V27.5L50 5Z" fill="#6366f1"/>
  <path d="M50 5L93.3 27.5V72.5L50 95L6.7 72.5V27.5L50 5Z" stroke="#818cf8" stroke-width="1.5" stroke-opacity="0.5"/>
  <ellipse cx="50" cy="50" rx="24" ry="14" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="50" cy="50" r="6" fill="white"/>
  <path d="M26 50C26 50 38 38 50 38C62 38 74 50 74 50" stroke="white" stroke-width="2" stroke-linecap="round" stroke-opacity="0.4"/>
  <path d="M26 50C26 50 38 62 50 62C62 62 74 50 74 50" stroke="white" stroke-width="2" stroke-linecap="round" stroke-opacity="0.4"/>
</svg>`;

// === Simulated Session Data ===
const MOCK_SESSIONS = [
  { id: 'a1b2c3d4', repo: 'frontend-app', branch: 'main', model: 'claude-sonnet-4', tokens: 45230, events: 312, turns: 18, tools: 42 },
  { id: 'e5f6g7h8', repo: 'api-server', branch: 'feat/auth', model: 'gpt-4.1', tokens: 78450, events: 567, turns: 32, tools: 89 },
  { id: 'i9j0k1l2', repo: 'data-pipeline', branch: 'develop', model: 'claude-sonnet-4', tokens: 23100, events: 145, turns: 8, tools: 21 },
  { id: 'm3n4o5p6', repo: 'mobile-app', branch: 'feat/ui', model: 'claude-sonnet-4', tokens: 91200, events: 823, turns: 45, tools: 112 },
  { id: 'q7r8s9t0', repo: 'frontend-app', branch: 'fix/perf', model: 'gpt-4.1', tokens: 15800, events: 98, turns: 5, tools: 12 },
  { id: 'u1v2w3x4', repo: 'infra-config', branch: 'main', model: 'claude-sonnet-4', tokens: 34500, events: 234, turns: 14, tools: 38 },
  { id: 'y5z6a7b8', repo: 'api-server', branch: 'main', model: 'claude-opus-4', tokens: 125000, events: 1024, turns: 58, tools: 156 },
  { id: 'c9d0e1f2', repo: 'docs-site', branch: 'update-guide', model: 'gpt-4.1', tokens: 8900, events: 67, turns: 4, tools: 8 },
  { id: 'g3h4i5j6', repo: 'ml-service', branch: 'train/v2', model: 'claude-sonnet-4', tokens: 156000, events: 1456, turns: 72, tools: 198 },
  { id: 'k7l8m9n0', repo: 'frontend-app', branch: 'feat/dashboard', model: 'claude-sonnet-4', tokens: 67800, events: 489, turns: 28, tools: 67 },
  { id: 'o1p2q3r4', repo: 'api-server', branch: 'refactor/db', model: 'gpt-4.1', tokens: 42300, events: 301, turns: 16, tools: 45 },
  { id: 's5t6u7v8', repo: 'mobile-app', branch: 'main', model: 'claude-sonnet-4', tokens: 89100, events: 712, turns: 38, tools: 95 },
  { id: 'w9x0y1z2', repo: 'data-pipeline', branch: 'feat/streaming', model: 'claude-opus-4', tokens: 198000, events: 1823, turns: 86, tools: 245 },
  { id: 'a3b4c5d6', repo: 'frontend-app', branch: 'main', model: 'claude-sonnet-4', tokens: 31200, events: 198, turns: 11, tools: 28 },
  { id: 'e7f8g9h0', repo: 'infra-config', branch: 'feat/monitoring', model: 'gpt-4.1', tokens: 19800, events: 134, turns: 7, tools: 18 },
  { id: 'i1j2k3l4', repo: 'api-server', branch: 'feat/cache', model: 'claude-sonnet-4', tokens: 55600, events: 412, turns: 22, tools: 58 },
  { id: 'm5n6o7p8', repo: 'ml-service', branch: 'main', model: 'claude-opus-4', tokens: 234000, events: 2100, turns: 95, tools: 312 },
  { id: 'q9r0s1t2', repo: 'docs-site', branch: 'main', model: 'gpt-4.1', tokens: 12400, events: 89, turns: 6, tools: 14 },
  { id: 'u3v4w5x6', repo: 'frontend-app', branch: 'fix/a11y', model: 'claude-sonnet-4', tokens: 28900, events: 176, turns: 10, tools: 24 },
  { id: 'y7z8a9b0', repo: 'mobile-app', branch: 'feat/offline', model: 'claude-sonnet-4', tokens: 71400, events: 534, turns: 30, tools: 78 },
];

// === Simulated Tool Call Names ===
const MOCK_TOOL_NAMES = [
  'read_file', 'edit_file', 'create_file', 'list_directory',
  'grep_search', 'run_terminal_command', 'web_search',
  'code_analysis', 'test_runner', 'git_diff', 'git_commit',
  'file_search', 'semantic_search', 'ask_followup',
];

// === Simulated Code Snippets (for stream animation) ===
const MOCK_CODE_SNIPPETS = [
  `function parseEvents(path) {\n  const events = readFileSync(path);\n  return events.map(e => deserialize(e));\n}`,
  `interface SessionSummary {\n  id: string;\n  repo: string;\n  totalTokens: number;\n  turnCount: number;\n}`,
  `async fn discover_sessions(dir: &Path) -> Vec<Session> {\n    let entries = fs::read_dir(dir)?;\n    entries.filter(|e| is_uuid(e.name()))\n}`,
  `const analytics = computed(() => ({\n  totalSessions: sessions.value.length,\n  avgTokens: mean(sessions.value.map(s => s.tokens)),\n}))`,
  `SELECT s.id, s.summary, s.total_tokens\nFROM sessions s\nJOIN sessions_fts ON s.id = sessions_fts.rowid\nWHERE sessions_fts MATCH ?`,
  `pub struct TurnToolCall {\n    pub tool_name: String,\n    pub duration_ms: Option<u64>,\n    pub success: bool,\n    pub intention: Option<String>,\n}`,
  `export function reconstructTurns(events: TypedEvent[]): Turn[] {\n  return events.reduce((turns, event) => {\n    // Group by turn boundaries\n  }, []);\n}`,
  `<template>\n  <div class="session-card" @click="navigate">\n    <Badge :variant="statusVariant">{{ status }}</Badge>\n    <span class="repo">{{ session.repo }}</span>\n  </div>\n</template>`,
];

// === Simulated Conversation Fragments ===
const MOCK_CONVERSATIONS = [
  { role: 'user', text: 'Can you refactor the authentication module to use JWT?' },
  { role: 'assistant', text: 'I\'ll refactor the auth module. Let me first read the current implementation...' },
  { role: 'user', text: 'Add error handling for the API endpoints' },
  { role: 'assistant', text: 'I\'ll add comprehensive error handling with proper HTTP status codes and error messages.' },
  { role: 'user', text: 'Create unit tests for the data processing pipeline' },
  { role: 'assistant', text: 'I\'ll create tests covering the parsing, transformation, and output stages...' },
  { role: 'user', text: 'Fix the performance issue in the dashboard component' },
  { role: 'assistant', text: 'Looking at the component, I can see it\'s re-rendering unnecessarily. Let me optimize with memoization...' },
];

// === Feature Descriptions (for carousel) ===
const FEATURES = [
  {
    icon: '💬',
    title: 'Conversation Viewer',
    description: 'Explore every turn of your AI coding sessions with rich rendering',
    color: 'var(--accent-fg)',
  },
  {
    icon: '📊',
    title: 'Analytics Dashboard',
    description: 'Track token usage, costs, and productivity metrics over time',
    color: 'var(--success-fg)',
  },
  {
    icon: '⏱️',
    title: 'Session Timeline',
    description: 'Waterfall visualization of tool calls, subagents, and timing',
    color: 'var(--warning-fg)',
  },
  {
    icon: '🔧',
    title: 'Tool Analysis',
    description: 'Understand which tools are used most and their success rates',
    color: 'var(--done-fg)',
  },
  {
    icon: '💻',
    title: 'Code Impact',
    description: 'See files modified, lines changed, and code patterns across sessions',
    color: 'var(--danger-fg)',
  },
  {
    icon: '🔍',
    title: 'Full-Text Search',
    description: 'Search across all sessions, conversations, and tool outputs instantly',
    color: 'var(--accent-fg)',
  },
];

// ============================================================
// Simulation Engine
// ============================================================

class LoadingSimulator {
  constructor(options = {}) {
    this.totalSessions = options.totalSessions || MOCK_SESSIONS.length;
    this.durationMs = options.durationMs || 10000;  // total simulation time
    this.onProgress = options.onProgress || (() => {});
    this.onSessionProcessed = options.onSessionProcessed || (() => {});
    this.onStatsUpdate = options.onStatsUpdate || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onPhaseChange = options.onPhaseChange || (() => {});

    this._running = false;
    this._currentSession = 0;
    this._stats = {
      sessionsProcessed: 0,
      totalTokens: 0,
      totalEvents: 0,
      totalTurns: 0,
      totalToolCalls: 0,
    };
    this._startTime = 0;
    this._animationFrame = null;
    this._sessionTimers = [];
    this._phase = 'idle'; // idle → discovering → indexing → finalizing → complete
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._currentSession = 0;
    this._startTime = performance.now();
    this._stats = { sessionsProcessed: 0, totalTokens: 0, totalEvents: 0, totalTurns: 0, totalToolCalls: 0 };

    // Phase 1: Discovering (first 10% of time)
    this._setPhase('discovering');
    
    const discoverTime = this.durationMs * 0.08;
    const indexTime = this.durationMs * 0.82;
    const finalizeTime = this.durationMs * 0.10;

    // Phase 2: Indexing (middle 82% of time)
    setTimeout(() => {
      if (!this._running) return;
      this._setPhase('indexing');
      this._scheduleSessionProcessing(indexTime);
    }, discoverTime);

    // Phase 3: Finalizing
    setTimeout(() => {
      if (!this._running) return;
      this._setPhase('finalizing');
    }, discoverTime + indexTime);

    // Phase 4: Complete
    setTimeout(() => {
      if (!this._running) return;
      this._setPhase('complete');
      this._running = false;
      this.onComplete(this._stats);
    }, this.durationMs);

    // Smooth progress animation
    this._animateProgress();
  }

  stop() {
    this._running = false;
    this._sessionTimers.forEach(t => clearTimeout(t));
    this._sessionTimers = [];
    if (this._animationFrame) cancelAnimationFrame(this._animationFrame);
  }

  reset() {
    this.stop();
    this._currentSession = 0;
    this._stats = { sessionsProcessed: 0, totalTokens: 0, totalEvents: 0, totalTurns: 0, totalToolCalls: 0 };
    this._phase = 'idle';
  }

  _setPhase(phase) {
    this._phase = phase;
    this.onPhaseChange(phase);
  }

  _scheduleSessionProcessing(duration) {
    // Distribute session completions across the indexing phase
    // Use slight randomization for realism
    const baseInterval = duration / this.totalSessions;
    
    for (let i = 0; i < this.totalSessions; i++) {
      const jitter = (Math.random() - 0.5) * baseInterval * 0.6;
      const delay = baseInterval * (i + 0.5) + jitter;
      
      const timer = setTimeout(() => {
        if (!this._running) return;
        this._processSession(i);
      }, Math.max(0, delay));
      
      this._sessionTimers.push(timer);
    }
  }

  _processSession(index) {
    const session = MOCK_SESSIONS[index % MOCK_SESSIONS.length];
    this._currentSession = index + 1;
    this._stats.sessionsProcessed = this._currentSession;
    this._stats.totalTokens += session.tokens;
    this._stats.totalEvents += session.events;
    this._stats.totalTurns += session.turns;
    this._stats.totalToolCalls += session.tools;

    this.onSessionProcessed({
      current: this._currentSession,
      total: this.totalSessions,
      session: session,
    });

    this.onStatsUpdate({ ...this._stats });
  }

  _animateProgress() {
    if (!this._running) return;

    const elapsed = performance.now() - this._startTime;
    const rawProgress = Math.min(elapsed / this.durationMs, 1);
    
    // Ease-out for smoother feel
    const progress = 1 - Math.pow(1 - rawProgress, 2);
    
    this.onProgress(progress, this._phase);

    if (rawProgress < 1) {
      this._animationFrame = requestAnimationFrame(() => this._animateProgress());
    }
  }
}

// ============================================================
// Utility: Animated Number Counter
// ============================================================

class AnimatedCounter {
  constructor(element, options = {}) {
    this.el = element;
    this.current = 0;
    this.target = 0;
    this.format = options.format || ((n) => n.toLocaleString());
    this.speed = options.speed || 0.08; // lerp factor
    this._raf = null;
  }

  set(value) {
    this.target = value;
    if (!this._raf) this._animate();
  }

  _animate() {
    const diff = this.target - this.current;
    if (Math.abs(diff) < 1) {
      this.current = this.target;
      this.el.textContent = this.format(this.current);
      this._raf = null;
      return;
    }

    this.current += diff * this.speed;
    this.el.textContent = this.format(Math.round(this.current));
    this._raf = requestAnimationFrame(() => this._animate());
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}

// ============================================================
// Utility: Demo Controls Setup
// ============================================================

function createDemoControls(container, options = {}) {
  const defaultDuration = options.defaultDuration || 10;
  const onStart = options.onStart || (() => {});
  const onDurationChange = options.onDurationChange || (() => {});

  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>
      Duration: 
      <input type="range" id="speed-slider" min="3" max="30" value="${defaultDuration}" step="1">
      <span class="speed-value" id="speed-display">${defaultDuration}s</span>
    </label>
    <label>
      Sessions:
      <input type="range" id="session-slider" min="5" max="150" value="20" step="5">
      <span class="speed-value" id="session-display">20</span>
    </label>
    <button id="btn-start">▶ Play</button>
    <button id="btn-reset">↺ Reset</button>
  `;

  (container || document.body).appendChild(controls);

  const speedSlider = controls.querySelector('#speed-slider');
  const speedDisplay = controls.querySelector('#speed-display');
  const sessionSlider = controls.querySelector('#session-slider');
  const sessionDisplay = controls.querySelector('#session-display');
  const btnStart = controls.querySelector('#btn-start');
  const btnReset = controls.querySelector('#btn-reset');

  let currentDuration = defaultDuration;
  let currentSessions = 20;

  speedSlider.addEventListener('input', () => {
    currentDuration = parseInt(speedSlider.value);
    speedDisplay.textContent = currentDuration + 's';
    onDurationChange(currentDuration, currentSessions);
  });

  sessionSlider.addEventListener('input', () => {
    currentSessions = parseInt(sessionSlider.value);
    sessionDisplay.textContent = currentSessions;
    onDurationChange(currentDuration, currentSessions);
  });

  btnStart.addEventListener('click', () => {
    onStart(currentDuration, currentSessions);
  });

  btnReset.addEventListener('click', () => {
    if (options.onReset) options.onReset();
  });

  return { controls, getDuration: () => currentDuration, getSessions: () => currentSessions };
}

// ============================================================
// Utility: Format helpers
// ============================================================

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function formatNumber(n) {
  return n.toLocaleString();
}

function formatPercent(n) {
  return Math.round(n * 100) + '%';
}
