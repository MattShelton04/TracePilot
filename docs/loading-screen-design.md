# TracePilot Loading Screen Design

> Design report for the loading/transition screen shown between the Setup Wizard's "Launch TracePilot" button and the main application.

## Problem Statement

After clicking "Launch TracePilot" in the Setup Wizard, the app saves configuration and indexes all discovered sessions. This process takes **3–30+ seconds** depending on session count. Currently, the user sees only an inline spinner on the button with minimal progress text ("Indexing 42/150 sessions…"). There is no dedicated transition experience.

**Goals:**
- Create a visually polished loading screen that matches the Variant C design system
- Show meaningful progress (session count, token metrics, phase indicators)
- Work gracefully for both fast (3s) and slow (30s) loads
- Make the wait feel productive/educational
- Build excitement for the features the user is about to use

## Architecture Context

### Data Available During Loading

| Data Source | Timing | What It Provides |
|---|---|---|
| `validate_session_dir()` | Instant | Total session count to index |
| `indexing-started` event | Start of indexing | Signal to show loading screen |
| `indexing-progress` event | Per-session | `{ current, total }` — incremental progress |
| `indexing-finished` event | End of indexing | Signal to transition out |
| `get_analytics()` | Post-indexing | Aggregate stats (tokens, cost, model distribution) |

### Current Flow (SetupWizard.vue)

```
finishSetup() →
  1. saving = true
  2. Build config object
  3. await saveConfig(config)         ← Tauri IPC
  4. await reindexSessions()          ← Tauri IPC (emits progress events)
  5. emit('setup-complete')           ← Hides wizard, shows main app
```

### Proposed Flow

```
finishSetup() →
  1. saving = true
  2. Build config object
  3. await saveConfig(config)
  4. Show LoadingScreen component     ← NEW: transition to loading screen
  5. reindexSessions() running        ← Progress events update the loading screen
  6. On indexing-finished:
     a. Optionally fetch get_analytics() for final stats display
     b. Play completion animation (600ms)
     c. emit('setup-complete')        ← Transition to main app
```

## Prototypes

> **Note:** HTML prototypes were removed during docs cleanup. The design descriptions below document the five explored approaches. The design system tokens are preserved in `docs/design/prototypes/shared/`.

### Prototype A: "Pulse & Stats"

**File:** `prototype-a-pulse-stats.html`

**Concept:** Minimal and elegant. Centered logo with a breathing glow ring, SVG circular progress indicator, and 4 animated stat counters that smoothly count up as sessions are processed.

**Best for:** Short loads (3–10s) where a clean, uncluttered feel is important.

**Key elements:**
- Pulsing logo with ambient indigo glow
- SVG progress ring with gradient stroke
- Phase text crossfades ("Discovering…" → "Indexing…" → "Finalizing…" → "Ready!")
- 4 stat cards: Tokens, Events, Turns, Tool Calls (lerp-based smooth counting)
- Completion: stats flash green sequentially → content slides up and fades

---

### Prototype B: "Feature Showcase Carousel"

**File:** `prototype-b-feature-carousel.html`

**Concept:** Educational carousel that showcases TracePilot features while the user waits. Each card has an animated mini-preview demonstrating the feature.

**Best for:** Longer loads (15–30s) where keeping the user engaged matters most.

**Key elements:**
- 6 feature cards auto-rotate every 4.5 seconds
- Each card has a unique animated preview:
  - Conversation Viewer: messages appearing in a mini chat UI
  - Analytics Dashboard: bar charts growing, donut chart filling
  - Session Timeline: waterfall bars cascading
  - Tool Analysis: horizontal bars extending with percentages
  - Code Impact: diff lines appearing (green/red)
  - Full-Text Search: search text typing with results appearing
- Clickable dot indicators for manual navigation
- Progress info footer with session/token counts

---

### Prototype C: "Code Stream"

**File:** `prototype-c-code-stream.html`

**Concept:** Cinematic and dramatic. Background columns of code scroll downward (Matrix-style, but with real code snippets), with a frosted glass center card showing progress. Visualizes "raw data → structured insights."

**Best for:** Making a strong visual impression. Great for demos and screenshots.

**Key elements:**
- 7 streaming code columns at different speeds and opacities
- Frosted glass center card with logo, progress ring, session counter
- Large token processing "odometer" with scanning line effect
- Code fragments visually collect toward the center during processing
- Completion: streams slow and fade, particle burst, checkmark appears

---

### Prototype D: "Constellation Network"

**File:** `prototype-d-constellation.html`

**Concept:** Sessions appear as glowing nodes forming a constellation/network graph. Connections form between related sessions (same repo, branch, model). The network grows organically as indexing progresses.

**Best for:** Visually representing the session discovery process. Most unique/memorable.

**Key elements:**
- Nodes positioned in concentric rings with jitter (force-directed feel)
- Node size ∝ token count, color = repo (7 distinct colors)
- Pop animation on appearance, gentle breathing/drift afterward
- SVG connection lines with traveling-light animation
- Dynamic repo legend builds as repos are discovered
- Frosted glass center card with progress stats
- Completion: all nodes pulse together, connections brighten

---

### Prototype E: "Timeline Builder"

**File:** `prototype-e-timeline-builder.html`

**Concept:** A mini waterfall/timeline chart that builds in real-time as sessions are indexed. Directly previews the Timeline feature users are about to use.

**Best for:** Feature preview — makes the user excited about the timeline feature specifically.

**Key elements:**
- Waterfall rows slide in from the right per session
- Each row has 3–8 colored bars (tool calls) by category
- Session labels typewrite in with cursor blink effect
- Aggregate stacked bar at top updates as tool calls accumulate
- Auto-scrolls to keep latest rows visible
- Hover tooltips on bars show tool names
- Stat counters at bottom: Sessions, Tokens, Events, Tool Calls

---

### Prototype F: "Stats + Feature Hybrid"

**File:** `prototype-f-stats-feature-hybrid.html`

**Concept:** Combines the best of Prototypes A and B. Left panel shows live stat counters (sessions with mini progress bar, tokens, events, tool calls, unique repos), right panel rotates through feature showcase cards with animated previews. Ends with a zoom-in that reveals a mock homepage.

**Best for:** The "complete package" — informative stats + educational features + premium ending.

**Key elements:**
- Phase 1: Centered logo discovery → logo shrinks to top-left header
- Split layout: live stats left, feature carousel right
- 4 animated feature previews (chat, charts, timeline, tool bars)
- Completion: green glow on stats → "✓ All sessions indexed" summary
- Ending: scale(1→1.15) + blur fade while mock homepage (sidebar + session card grid) fades in behind

---

### Prototype G: "Orbital"

**File:** `prototype-g-orbital.html`

**Concept:** Space-themed — TracePilot logo as a star with sessions orbiting in 3 concentric elliptical rings. Ends with a dramatic zoom-through into the homepage.

**Best for:** Visual spectacle. The orbital motion is mesmerizing for longer loads.

**Key elements:**
- 3 tilted elliptical orbits (8s/14s/22s periods) with conic-gradient trails
- Session dots colored by repo, appearing with flash animation
- Stats overlay (bottom-left) with session counter + tokens
- 40 ambient background particles for depth
- Ending: dots spiral inward → logo scales 3× with blur → white flash → homepage fade-in

---

### Prototype H: "Data Assembler"

**File:** `prototype-h-data-assembler.html`

**Concept:** 30 floating data fragments (code snippets, JSON values, badges, chart shapes, file paths) scattered around the screen progressively organize into structured UI panels that form the actual app layout.

**Best for:** Storytelling — visually shows "chaos → order" as raw data becomes structured insights.

**Key elements:**
- Scatter phase: fragments drift randomly with slight rotation
- Organize phase: fragments gravitate toward target zones (stats/sessions/charts/timeline)
- Solidify phase: panel borders materialize, sidebar/header appear
- Ending: logo slides to header position, scale(0.95→1.0) reveal, shimmer wave sweeps across assembled app

---

### Prototype I: "Spotlight Reveal"

**File:** `prototype-i-spotlight-reveal.html`

**Concept:** The mock homepage is already rendered but hidden in darkness. A CSS mask-image spotlight wanders across the screen revealing glimpses of the app, then expands to illuminate everything.

**Best for:** Cinematic mystery/anticipation. The user gets teasing glimpses of features before the full reveal.

**Key elements:**
- Catmull-Rom spline spotlight path for smooth wandering
- Afterglow zones linger 2.5s after spotlight passes
- Full homepage underneath (header, 6-item sidebar, stats bar, 2×3 session card grid)
- Frosted-glass progress panel stays illuminated via secondary spotlight
- Ending: rapid radial wipe → white flash → shimmer wave across fully revealed homepage

---

### Prototype J: "Portal"

**File:** `prototype-j-portal.html`

**Concept:** The hexagonal TracePilot logo transforms into a portal. Colored data particles stream from screen edges toward the portal center. Ends with a hyperspace-style zoom-through into the app.

**Best for:** Maximum drama. The zoom-through ending is the most exhilarating of all prototypes.

**Key elements:**
- 4 concentric hexagonal rings with alternating rotation and phased pulse
- ~100 particles streaming inward with bezier curves, some carrying text labels
- Stats arranged at compass points around the portal
- Ending: particle speed triples → rings scale(12×) + speed lines → white flash → homepage

---

### Prototype K: "Constellation V2"

**File:** `prototype-k-constellation-v2.html`

**Concept:** Enhanced constellation with richer nodes (mini session cards, not just dots), repo-clustered layout, typed connections, and an ending where nodes morph into a session list grid as the app chrome appears.

**Best for:** Most meaningful ending — the constellation literally becomes the app. The "wow" moment is watching scattered stars organize into your workspace.

**Key elements:**
- Nodes start as dots, expand to mini cards (repo + branch + tokens)
- 7 repo clusters with floating labels
- Solid connections (same repo) + dashed connections (same model)
- Ending: connections fade → nodes animate to 3-column grid → cards expand to full session cards → header/sidebar slides in → shimmer wave polish

---

## Demo Controls

All prototypes include a control bar at the bottom for testing:

| Control | Range | Purpose |
|---|---|---|
| Duration slider | 3–30 seconds | Simulates fast vs. slow indexing |
| Sessions slider | 5–150 | Simulates different session counts |
| ▶ Play button | — | Starts the simulation |
| ↺ Reset button | — | Resets to initial state |

## Design System Compliance

All prototypes follow the Variant C ("Hybrid") design system:

- **Colors:** Dark canvas `#0d1117`, indigo accent `#6366f1`/`#818cf8`, semantic palette (emerald, amber, rose, violet)
- **Typography:** Inter Variable (UI), JetBrains Mono (code/numbers)
- **Borders:** `#30363d` with 6–12px radius
- **Animations:** CSS transitions (100ms/180ms/280ms), `prefers-reduced-motion` respected
- **Spacing:** 4px base grid

## Implementation Steps

### Step 1: Create the Vue Component

Create `apps/desktop/src/components/LoadingScreen.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { listen } from '@tauri-apps/api/event'

const props = defineProps<{
  totalSessions: number
}>()

const emit = defineEmits<{
  complete: []
}>()

const phase = ref<'discovering' | 'indexing' | 'finalizing' | 'complete'>('discovering')
const current = ref(0)
const total = ref(props.totalSessions)
const stats = ref({ tokens: 0, events: 0, turns: 0, tools: 0 })

// Listen to Tauri indexing events
let unlistenProgress: (() => void) | null = null
let unlistenFinished: (() => void) | null = null

onMounted(async () => {
  unlistenProgress = await listen<{ current: number; total: number }>(
    'indexing-progress',
    (event) => {
      current.value = event.payload.current
      total.value = event.payload.total
      phase.value = 'indexing'
    }
  )

  unlistenFinished = await listen('indexing-finished', () => {
    phase.value = 'complete'
    // Play completion animation, then emit
    setTimeout(() => emit('complete'), 800)
  })

  // Brief "discovering" phase before indexing begins
  setTimeout(() => {
    if (phase.value === 'discovering') {
      phase.value = 'indexing'
    }
  }, 500)
})

onUnmounted(() => {
  unlistenProgress?.()
  unlistenFinished?.()
})
</script>
```

### Step 2: Add Token/Event Aggregation to Indexing Events

To show live token/event counts during indexing, extend the Rust indexing progress to include running totals.

In `crates/tracepilot-tauri-bindings/src/lib.rs`, modify the `indexing-progress` event payload:

```rust
#[derive(Clone, Serialize)]
struct IndexingProgress {
    current: usize,
    total: usize,
    // New fields for rich progress
    total_tokens: u64,
    total_events: u64,
    session_repo: Option<String>,
    session_model: Option<String>,
}
```

Update the progress callback in `reindex_sessions` to accumulate these from each processed session's summary.

### Step 3: Integrate into SetupWizard / App.vue

Modify the flow in `SetupWizard.vue`:

```typescript
async function finishSetup() {
  saving.value = true
  await saveConfig(config)
  
  // Switch to loading screen instead of showing inline spinner
  showLoadingScreen.value = true
  
  // Start indexing (non-blocking — progress via events)
  reindexSessions().catch(console.error)
}

function onLoadingComplete() {
  showLoadingScreen.value = false
  emit('setup-complete')
}
```

In the template, conditionally render the loading screen:

```vue
<LoadingScreen
  v-if="showLoadingScreen"
  :total-sessions="validationResult.sessionCount"
  @complete="onLoadingComplete"
/>
```

### Step 4: Handle Edge Cases

| Scenario | Behavior |
|---|---|
| **0 sessions** | Skip loading screen entirely, go straight to app |
| **< 5 sessions** | Show loading screen but with shortened minimum display time (1.5s) |
| **Indexing fails** | Show error state briefly, then proceed to app anyway (non-blocking) |
| **Very fast load (< 2s)** | Ensure minimum display time so animations don't flash |
| **`prefers-reduced-motion`** | Disable all animations, show static progress text |

### Step 5: Post-Indexing Stats Flash (Optional Enhancement)

After `indexing-finished`, call `get_analytics()` and briefly display aggregate stats before transitioning:

```
✓ 150 sessions indexed
  1.2M tokens · 234 tool calls · 12 repositories
```

This gives a satisfying "summary" moment before the main app loads.

### Step 6: Reuse for Re-index from Settings

The same `LoadingScreen` component can be shown when the user triggers a full re-index from the Settings page, providing a consistent experience.

## Recommendation

For the production implementation, consider a **hybrid approach** combining elements:

- **Primary visual**: Prototype A's centered logo + progress ring (works for all load times)
- **Short loads (< 5s)**: Just the logo, ring, and phase text — no stats grid
- **Long loads (> 8s)**: Fade in stat counters + optionally one element from Prototype B's feature carousel
- **Completion**: Brief stats summary flash from Prototype A's completion sequence

This adaptive approach ensures the loading screen feels appropriate regardless of duration — never too much for a quick load, never too little for a long one.
