<template>
  <div
    v-if="!dismissed"
    class="indexing-loading-screen"
    :class="{ 'fade-out': fadingOut }"
    :style="{ opacity: fadingOut ? 0 : undefined, transform: fadingOut ? 'scale(1.02)' : undefined }"
  >
    <!-- Top progress bar -->
    <div class="progress-bar-track" :class="{ visible: phase !== 'idle' }">
      <div class="progress-bar-fill" :style="{ width: progressPct + '%' }" />
    </div>

    <!-- Orbital field -->
    <div ref="orbitalFieldRef" class="orbital-field">
      <!-- Ambient particles (created once on mount) -->
      <div ref="ambientContainerRef" class="ambient-particles" />

      <!-- SVG layer: orbital paths + connection lines -->
      <svg ref="svgLayerRef" class="orbital-svg" />

      <!-- Orbiting nodes -->
      <div
        v-for="node in visibleNodes"
        :key="node.id"
        class="orbit-node"
        :class="{ active: node.active }"
        :style="{
          left: node.x + 'px',
          top: node.y + 'px',
          '--node-color': node.color,
          '--node-glow': node.color + '55',
        }"
      >
        <div class="node-dot" />
        <div
          class="mini-card"
          :class="{ visible: node.expanded }"
          :style="{ '--node-color': node.color }"
        >
          <div class="mc-repo">
            <span class="mc-repo-dot" />
            {{ node.repo }}
          </div>
          <div class="mc-branch">{{ node.branchDisplay }}</div>
        </div>
      </div>

      <!-- Pulse ripples -->
      <div
        v-for="ripple in ripples"
        :key="ripple.id"
        class="pulse-ripple active"
        :style="{ left: centerX + 'px', top: centerY + 'px' }"
      />

      <!-- Center logo hub -->
      <div class="logo-hub" :class="{ visible: phase !== 'idle' || showLogo }">
        <div class="logo-icon">
          <div class="logo-glow" />
          <LogoIcon :size="70" />
        </div>
        <div class="phase-text">{{ phaseLabel }}</div>
        <div v-if="sessionCounterText" class="session-counter">{{ sessionCounterText }}</div>
      </div>
    </div>

    <!-- Stats panel -->
    <div class="stats-panel" :class="{ visible: phase === 'indexing' || phase === 'finalizing' }">
      <div class="stats-row">
        <div class="stat-item">
          <span class="stat-item-label">Sessions:</span>
          <span class="stat-item-value">{{ displaySessions }}/{{ props.totalSessions }}</span>
        </div>
        <div class="stat-divider" />
        <div class="stat-item">
          <span class="stat-item-label">Tokens:</span>
          <span class="stat-item-value">{{ displayTokens }}</span>
        </div>
        <div class="stat-divider" />
        <div class="stat-item">
          <span class="stat-item-label">Events:</span>
          <span class="stat-item-value">{{ displayEvents }}</span>
        </div>
        <div class="stat-divider" />
        <div class="stat-item">
          <span class="stat-item-label">Repos:</span>
          <span class="stat-item-value">{{ displayRepos }}</span>
        </div>
      </div>
      <div class="stats-mini-bar">
        <div class="stats-mini-fill" :style="{ width: progressPct + '%' }" />
      </div>
      <div class="repo-legend">
        <div
          v-for="item in repoLegendItems"
          :key="item.name"
          class="repo-legend-item visible"
        >
          <span class="legend-dot" :style="{ background: item.color }" />
          {{ item.name }}
        </div>
      </div>
    </div>

    <!-- Completion flash -->
    <div class="completion-flash" :class="{ active: completionFlashActive }" />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  reactive,
  computed,
  onMounted,
  onUnmounted,
  nextTick,
  watch,
} from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { IndexingProgressPayload } from '@tracepilot/types'
import { reindexSessions } from '@tracepilot/client'
import LogoIcon from '@/components/icons/LogoIcon.vue'

// ── Props & Emits ──────────────────────────────────────────────────────────────

const props = defineProps<{
  totalSessions: number
}>()

const emit = defineEmits<{
  complete: []
}>()

// ── Constants ──────────────────────────────────────────────────────────────────

const LANES = [
  { rx: 150, ry: 100, period: 12, tiltDeg: 15, tokenMax: 30_000 },
  { rx: 250, ry: 165, period: 20, tiltDeg: -10, tokenMax: 100_000 },
  { rx: 360, ry: 235, period: 30, tiltDeg: 8, tokenMax: Infinity },
] as const

const REPO_PALETTE = [
  '#818cf8', '#34d399', '#fbbf24', '#f87171',
  '#a78bfa', '#38bdf8', '#fb923c',
]

const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Preparing…',
  discovering: 'Discovering sessions…',
  indexing: 'Indexing sessions…',
  finalizing: 'Building search index…',
  complete: 'Ready — launching TracePilot',
}

const MAX_VISIBLE_NODES = 40
const MAX_CONNECTIONS = 80

// ── Types ──────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'discovering' | 'indexing' | 'finalizing' | 'complete'

interface OrbitNode {
  id: number
  repo: string
  branch: string
  branchDisplay: string
  color: string
  laneIdx: number
  angle: number
  speedJitter: number
  x: number
  y: number
  active: boolean
  expanded: boolean
  createdAt: number
}

interface Connection {
  aId: number
  bId: number
  color: string
  el: SVGLineElement
}

interface Ripple {
  id: number
  removeAt: number
}

// ── Reactive state ─────────────────────────────────────────────────────────────

const phase = ref<Phase>('idle')
const showLogo = ref(false)
const dismissed = ref(false)
const fadingOut = ref(false)
const completionFlashActive = ref(false)
const progressPct = ref(0)
const sessionCounterText = ref('')

// Animated counters — lerped values for smooth display
const targetSessions = ref(0)
const targetTokens = ref(0)
const targetEvents = ref(0)
const targetRepos = ref(0)
const currentSessions = ref(0)
const currentTokens = ref(0)
const currentEvents = ref(0)
const currentRepos = ref(0)

// Orbital nodes and connections
const nodes = reactive<OrbitNode[]>([])
const connections: Connection[] = []
const ripples = ref<Ripple[]>([])
let nodeIdCounter = 0
let rippleIdCounter = 0
let sessionsProcessed = 0

// Repo color assignments
const repoColorMap = new Map<string, string>()
let nextColorIndex = 0
const repoLegendItems = ref<{ name: string; color: string }[]>([])

// Viewport & center
const centerX = ref(0)
const centerY = ref(0)
let fieldW = 0
let fieldH = 0

// Animation control
let animFrameId = 0
let lastTimestamp = 0
let globalSpeedMult = 1
let animating = false

// Timer tracking for cleanup
const pendingTimers = new Set<ReturnType<typeof setTimeout>>()
let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null
const SAFETY_TIMEOUT_MS = 60_000

// Minimum display time tracking
let mountTime = 0
const MIN_DISPLAY_MS = 1500

// Reduced motion
const prefersReducedMotion = ref(false)

// ── Template refs ──────────────────────────────────────────────────────────────

const orbitalFieldRef = ref<HTMLElement>()
const svgLayerRef = ref<SVGSVGElement>()
const ambientContainerRef = ref<HTMLElement>()

// ── SVG ellipse elements (not reactive, DOM-managed) ───────────────────────────

let laneEllipses: SVGEllipseElement[] = []

// ── Tauri event listeners ──────────────────────────────────────────────────────

let unlistenProgress: UnlistenFn | null = null
let unlistenStarted: UnlistenFn | null = null
let unlistenFinished: UnlistenFn | null = null

// ── Tracked timeout helper ─────────────────────────────────────────────────────

/** setTimeout that auto-cleans on unmount */
function safeTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const id = setTimeout(() => {
    pendingTimers.delete(id)
    fn()
  }, ms)
  pendingTimers.add(id)
  return id
}

// ── Computed ───────────────────────────────────────────────────────────────────

const phaseLabel = computed(() => PHASE_LABELS[phase.value])

const displaySessions = computed(() => String(Math.round(currentSessions.value)))
const displayTokens = computed(() => formatTokens(currentTokens.value))
const displayEvents = computed(() => formatTokens(currentEvents.value))
const displayRepos = computed(() => String(Math.round(currentRepos.value)))

const visibleNodes = computed(() => {
  if (nodes.length <= MAX_VISIBLE_NODES) return nodes
  return nodes.slice(nodes.length - MAX_VISIBLE_NODES)
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(Math.round(n))
}

function getRepoColor(repo: string): string {
  let color = repoColorMap.get(repo)
  if (!color) {
    color = REPO_PALETTE[nextColorIndex % REPO_PALETTE.length]
    nextColorIndex++
    repoColorMap.set(repo, color)
    repoLegendItems.value.push({ name: repo, color })
    targetRepos.value = repoColorMap.size
  }
  return color
}

function assignLane(tokens: number): number {
  for (let i = 0; i < LANES.length; i++) {
    if (tokens <= LANES[i].tokenMax) return i
  }
  return LANES.length - 1
}

/** Compute (x, y) on a tilted elliptical orbit. */
function getOrbitalPos(angle: number, laneIdx: number): { x: number; y: number } {
  const lane = LANES[laneIdx]
  const tiltRad = (lane.tiltDeg * Math.PI) / 180
  const ex = lane.rx * Math.cos(angle)
  const ey = lane.ry * Math.sin(angle)
  return {
    x: centerX.value + ex * Math.cos(tiltRad) - ey * Math.sin(tiltRad),
    y: centerY.value + ex * Math.sin(tiltRad) + ey * Math.cos(tiltRad),
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 2) + '…' : str
}

// ── Viewport measurement ───────────────────────────────────────────────────────

let resizeObserver: ResizeObserver | null = null

function measureField() {
  const el = orbitalFieldRef.value
  if (!el) return
  fieldW = el.clientWidth
  fieldH = el.clientHeight
  centerX.value = fieldW / 2
  centerY.value = fieldH / 2
  svgLayerRef.value?.setAttribute('viewBox', `0 0 ${fieldW} ${fieldH}`)
  updateLaneEllipsePositions()
}

// ── Ambient particles ──────────────────────────────────────────────────────────

function createAmbientParticles(count: number) {
  const container = ambientContainerRef.value
  if (!container) return
  container.innerHTML = ''

  if (prefersReducedMotion.value) return

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    p.className = 'ambient-particle'
    const size = 1 + Math.random() * 1.5
    const x = Math.random() * 100
    const y = Math.random() * 100
    const dx = (Math.random() - 0.5) * 60
    const dy = (Math.random() - 0.5) * 60
    const dur = 20 + Math.random() * 30
    const delay = Math.random() * dur
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${x}%; top:${y}%;
      --dx:${dx}px; --dy:${dy}px;
      animation-duration:${dur}s;
      animation-delay:-${delay}s;
    `
    container.appendChild(p)
  }
}

// ── SVG orbital ellipses ───────────────────────────────────────────────────────

function drawLaneEllipses() {
  const svg = svgLayerRef.value
  if (!svg) return

  laneEllipses.forEach((el) => el.remove())
  laneEllipses = []

  LANES.forEach((lane) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
    el.setAttribute('cx', String(centerX.value))
    el.setAttribute('cy', String(centerY.value))
    el.setAttribute('rx', String(lane.rx))
    el.setAttribute('ry', String(lane.ry))
    el.setAttribute('stroke', '#6366f1')
    el.setAttribute('stroke-opacity', '0')
    el.setAttribute('stroke-width', '1')
    el.setAttribute('fill', 'none')
    el.setAttribute('transform', `rotate(${lane.tiltDeg} ${centerX.value} ${centerY.value})`)

    // Stroke-dash draw-in effect
    const circumference = Math.PI * 2 * Math.max(lane.rx, lane.ry)
    el.setAttribute('stroke-dasharray', String(circumference))
    el.setAttribute('stroke-dashoffset', String(circumference))
    el.style.transition =
      'stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1), stroke-opacity 0.8s ease'

    svg.appendChild(el)
    laneEllipses.push(el)
  })
}

function showLaneEllipses() {
  laneEllipses.forEach((el, i) => {
    setTimeout(() => {
      el.setAttribute('stroke-opacity', '0.12')
      el.setAttribute('stroke-dashoffset', '0')
    }, i * 300)
  })
}

function updateLaneEllipsePositions() {
  laneEllipses.forEach((el, i) => {
    const lane = LANES[i]
    el.setAttribute('cx', String(centerX.value))
    el.setAttribute('cy', String(centerY.value))
    el.setAttribute('transform', `rotate(${lane.tiltDeg} ${centerX.value} ${centerY.value})`)
  })
}

// ── Node creation ──────────────────────────────────────────────────────────────

function createNode(
  repo: string,
  branch: string,
  tokens: number,
) {
  const laneIdx = assignLane(tokens)
  const color = getRepoColor(repo)
  const startAngle = Math.random() * Math.PI * 2
  const speedJitter = 0.85 + Math.random() * 0.3
  const pos = getOrbitalPos(startAngle, laneIdx)

  const node: OrbitNode = {
    id: nodeIdCounter++,
    repo,
    branch,
    branchDisplay: truncate(branch, 14),
    color,
    laneIdx,
    angle: startAngle,
    speedJitter,
    x: pos.x - 4,
    y: pos.y - 4,
    active: false,
    expanded: false,
    createdAt: performance.now(),
  }

  nodes.push(node)

  // Trigger dot pop on next frame
  requestAnimationFrame(() => {
    node.active = true
  })

  // Expand to mini-card after 800ms
  safeTimeout(() => {
    if (phase.value !== 'complete' && nodes.includes(node)) {
      node.expanded = true
    }
  }, 800)

  // Create SVG connections to same-repo nodes on same/adjacent lanes
  createConnectionsForNode(node)

  // Fade out oldest nodes when over limit
  if (nodes.length > MAX_VISIBLE_NODES + 10) {
    nodes.splice(0, nodes.length - MAX_VISIBLE_NODES)
  }

  return node
}

// ── Connections ─────────────────────────────────────────────────────────────────

function createConnectionsForNode(newNode: OrbitNode) {
  const svg = svgLayerRef.value
  if (!svg) return

  let added = 0
  for (let i = nodes.length - 2; i >= 0 && added < 2; i--) {
    const existing = nodes[i]
    if (existing.repo !== newNode.repo) continue
    if (Math.abs(existing.laneIdx - newNode.laneIdx) > 1) continue

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('stroke', newNode.color)
    line.setAttribute('stroke-opacity', '0')
    line.setAttribute('stroke-width', '0.8')
    line.setAttribute('stroke-linecap', 'round')
    line.style.transition = 'stroke-opacity 0.6s ease'
    svg.appendChild(line)

    requestAnimationFrame(() => {
      line.setAttribute('stroke-opacity', '0.2')
    })

    connections.push({ aId: newNode.id, bId: existing.id, color: newNode.color, el: line })
    added++

    // Cap total connections
    if (connections.length > MAX_CONNECTIONS) {
      const old = connections.shift()
      old?.el.remove()
    }
  }
}

function updateConnections() {
  const nodeMap = new Map<number, OrbitNode>()
  for (const n of nodes) nodeMap.set(n.id, n)

  for (const conn of connections) {
    const a = nodeMap.get(conn.aId)
    const b = nodeMap.get(conn.bId)
    if (!a || !b) continue
    const posA = getOrbitalPos(a.angle, a.laneIdx)
    const posB = getOrbitalPos(b.angle, b.laneIdx)
    conn.el.setAttribute('x1', String(posA.x))
    conn.el.setAttribute('y1', String(posA.y))
    conn.el.setAttribute('x2', String(posB.x))
    conn.el.setAttribute('y2', String(posB.y))
  }
}

// ── Pulse ripple ───────────────────────────────────────────────────────────────

function emitPulse() {
  if (prefersReducedMotion.value) return

  const id = rippleIdCounter++
  ripples.value.push({ id, removeAt: performance.now() + 1300 })

  // Briefly brighten lane ellipses
  laneEllipses.forEach((el) => {
    el.setAttribute('stroke-opacity', '0.25')
    setTimeout(() => el.setAttribute('stroke-opacity', '0.12'), 600)
  })

  // Clean up old ripples
  setTimeout(() => {
    ripples.value = ripples.value.filter((r) => r.id !== id)
  }, 1300)
}

// ── Animated counter lerp (runs inside the RAF loop) ───────────────────────────

function lerpCounters() {
  const rate = 0.15
  currentSessions.value += (targetSessions.value - currentSessions.value) * rate
  currentTokens.value += (targetTokens.value - currentTokens.value) * rate
  currentEvents.value += (targetEvents.value - currentEvents.value) * rate
  currentRepos.value += (targetRepos.value - currentRepos.value) * rate

  // Snap when close
  if (Math.abs(targetSessions.value - currentSessions.value) < 0.5)
    currentSessions.value = targetSessions.value
  if (Math.abs(targetTokens.value - currentTokens.value) < 0.5)
    currentTokens.value = targetTokens.value
  if (Math.abs(targetEvents.value - currentEvents.value) < 0.5)
    currentEvents.value = targetEvents.value
  if (Math.abs(targetRepos.value - currentRepos.value) < 0.5)
    currentRepos.value = targetRepos.value
}

// ── Main animation loop ────────────────────────────────────────────────────────

function animate(timestamp: number) {
  if (!animating) return

  if (!lastTimestamp) lastTimestamp = timestamp
  const dt = (timestamp - lastTimestamp) / 1000
  lastTimestamp = timestamp

  if (!prefersReducedMotion.value && phase.value !== 'complete') {
    // Advance orbital positions
    for (const node of nodes) {
      const lane = LANES[node.laneIdx]
      const angularSpeed = (Math.PI * 2) / lane.period
      node.angle += angularSpeed * dt * node.speedJitter * globalSpeedMult
      const pos = getOrbitalPos(node.angle, node.laneIdx)
      node.x = pos.x - 4
      node.y = pos.y - 4
    }
    updateConnections()
  }

  lerpCounters()

  animFrameId = requestAnimationFrame(animate)
}

// ── Phase transitions ──────────────────────────────────────────────────────────

function setPhase(newPhase: Phase) {
  phase.value = newPhase

  if (newPhase === 'discovering') {
    showLogo.value = true
    showLaneEllipses()
  }

  if (newPhase === 'finalizing') {
    globalSpeedMult = 0.5
    laneEllipses.forEach((el) => el.setAttribute('stroke-opacity', '0.2'))
  }
}

// ── Completion sequence ────────────────────────────────────────────────────────

async function handleCompletion() {
  // Guard against double-completion
  if (dismissed.value || phase.value === 'complete') return

  // Ensure minimum display time
  const elapsed = performance.now() - mountTime
  if (elapsed < MIN_DISPLAY_MS) {
    await new Promise((r) => setTimeout(r, MIN_DISPLAY_MS - elapsed))
  }

  phase.value = 'complete'

  // Step 1: Show "Ready" text + completion flash
  completionFlashActive.value = true

  // Step 2: Decelerate orbits over 300ms
  const decStart = performance.now()
  function decelerate() {
    const t = Math.min((performance.now() - decStart) / 300, 1)
    globalSpeedMult = Math.max(0.3 * (1 - t), 0)

    // Keep updating positions during deceleration
    for (const node of nodes) {
      const lane = LANES[node.laneIdx]
      const angularSpeed = (Math.PI * 2) / lane.period
      node.angle += angularSpeed * 0.016 * node.speedJitter * globalSpeedMult
      const pos = getOrbitalPos(node.angle, node.laneIdx)
      node.x = pos.x - 4
      node.y = pos.y - 4
    }
    updateConnections()

    if (t < 1) requestAnimationFrame(decelerate)
  }
  if (!prefersReducedMotion.value) {
    requestAnimationFrame(decelerate)
  }

  // Step 3: After 600ms, start fade-out
  safeTimeout(() => {
    fadingOut.value = true

    // Step 4: After fade completes (500ms), emit complete
    safeTimeout(() => {
      animating = false
      dismissed.value = true
      emit('complete')
    }, 500)
  }, 600)
}

// ── Tauri event handlers ───────────────────────────────────────────────────────

function onIndexingStarted() {
  setPhase('discovering')
}

function onIndexingProgress(payload: IndexingProgressPayload) {
  if (phase.value === 'discovering' || phase.value === 'idle') {
    setPhase('indexing')
  }

  // Update progress
  const pct = payload.total > 0 ? (payload.current / payload.total) * 100 : 0
  progressPct.value = pct

  // Update counter targets
  targetSessions.value = payload.current
  targetTokens.value = payload.totalTokens
  targetEvents.value = payload.totalEvents
  sessionCounterText.value = `${payload.current} / ${payload.total}`

  // Create orbiting node if this event has session info
  if (payload.sessionRepo) {
    createNode(
      payload.sessionRepo,
      payload.sessionBranch ?? 'main',
      payload.sessionTokens,
    )

    sessionsProcessed++
    if (sessionsProcessed % 10 === 0) {
      emitPulse()
    }
  }

  // Transition to finalizing at >90%
  if (pct > 90 && phase.value === 'indexing') {
    setPhase('finalizing')
  }
}

function onIndexingFinished() {
  // Snap counters to final values
  progressPct.value = 100
  handleCompletion()
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

onMounted(async () => {
  mountTime = performance.now()

  // Detect reduced motion preference
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // CRITICAL: Register event listeners BEFORE triggering indexing
  // to prevent the race condition where events fire before we're listening.
  unlistenStarted = await listen('indexing-started', () => {
    onIndexingStarted()
  })

  unlistenProgress = await listen<IndexingProgressPayload>('indexing-progress', (event) => {
    onIndexingProgress(event.payload)
  })

  unlistenFinished = await listen('indexing-finished', () => {
    onIndexingFinished()
  })

  await nextTick()

  // Measure viewport & set up resize observer
  measureField()
  resizeObserver = new ResizeObserver(() => measureField())
  if (orbitalFieldRef.value) {
    resizeObserver.observe(orbitalFieldRef.value)
  }

  // Create ambient particles and draw orbital paths
  createAmbientParticles(35)
  drawLaneEllipses()

  // Start animation loop
  animating = true
  lastTimestamp = 0
  animFrameId = requestAnimationFrame(animate)

  // Show logo after brief delay
  safeTimeout(() => {
    showLogo.value = true
  }, 200)

  // NOW trigger indexing — listeners are guaranteed to be active
  reindexSessions().catch((err) => {
    console.error('Indexing failed (non-fatal):', err)
    // Ensure we don't get stuck — transition to app
    handleCompletion()
  })

  // Safety timeout — if indexing-finished never arrives, auto-complete
  safetyTimeoutId = safeTimeout(() => {
    if (phase.value !== 'complete' && !dismissed.value) {
      console.warn('Loading screen safety timeout — proceeding to app')
      handleCompletion()
    }
  }, SAFETY_TIMEOUT_MS)
})

onUnmounted(() => {
  // Cancel animation frame
  animating = false
  if (animFrameId) {
    cancelAnimationFrame(animFrameId)
    animFrameId = 0
  }

  // Clean up all tracked timers
  for (const id of pendingTimers) clearTimeout(id)
  pendingTimers.clear()
  if (safetyTimeoutId) {
    clearTimeout(safetyTimeoutId)
    safetyTimeoutId = null
  }

  // Clean up Tauri event listeners
  unlistenStarted?.()
  unlistenProgress?.()
  unlistenFinished?.()

  // Clean up resize observer
  resizeObserver?.disconnect()
  resizeObserver = null

  // Remove SVG connection elements
  connections.forEach((c) => c.el.remove())
  connections.length = 0
  laneEllipses.forEach((el) => el.remove())
  laneEllipses = []
})
</script>

<style scoped>
/* ── Component root ── */
.indexing-loading-screen {
  position: fixed;
  inset: 0;
  background: #0d1117;
  z-index: 9999;
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.indexing-loading-screen.fade-out {
  pointer-events: none;
}

/* ── Progress bar (top) ── */
.progress-bar-track {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #21262d;
  z-index: 10000;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.progress-bar-track.visible {
  opacity: 1;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
  border-radius: 0 2px 2px 0;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.3);
}

/* ── Orbital field ── */
.orbital-field {
  position: fixed;
  inset: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── SVG layer ── */
.orbital-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.orbital-svg :deep(line) {
  stroke-linecap: round;
}

.orbital-svg :deep(ellipse) {
  fill: none;
  stroke-width: 1;
}

/* ── Center logo hub ── */
.logo-hub {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.8s ease, transform 0.8s ease;
  color: #818cf8;
}

.logo-hub.visible {
  opacity: 1;
}

.logo-hub .logo-icon {
  width: 70px;
  height: 70px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-hub .logo-glow {
  position: absolute;
  width: 160px;
  height: 160px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(99, 102, 241, 0.3) 0%,
    rgba(99, 102, 241, 0.08) 50%,
    transparent 70%
  );
  animation: logoGlowPulse 3s ease-in-out infinite;
  pointer-events: none;
}

@keyframes logoGlowPulse {
  0%,
  100% {
    opacity: 0.6;
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.1);
  }
}

.logo-hub .phase-text {
  font-size: 0.75rem;
  color: #7d8590;
  letter-spacing: 0.04em;
  text-align: center;
}

.logo-hub .session-counter {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  font-size: 0.75rem;
  color: #818cf8;
  font-variant-numeric: tabular-nums;
}

/* ── Orbiting nodes ── */
.orbit-node {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  will-change: transform;
}

.orbit-node .node-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--node-color, #818cf8);
  box-shadow: 0 0 10px 3px var(--node-glow, rgba(129, 140, 248, 0.4));
  transform: scale(0);
  opacity: 0;
}

.orbit-node.active .node-dot {
  animation: dotPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes dotPop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.8);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Mini card (expanded from dot) */
.orbit-node .mini-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  background: #161b22;
  border: 1px solid #30363d;
  border-left: 3px solid var(--node-color, #818cf8);
  border-radius: 8px;
  padding: 5px 10px;
  white-space: nowrap;
  pointer-events: auto;
  min-width: 100px;
  max-width: 140px;
  transition:
    transform 0.4s cubic-bezier(0.34, 1.2, 0.64, 1),
    opacity 0.3s ease;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.3),
    0 0 12px var(--node-glow, rgba(129, 140, 248, 0.15));
}

.orbit-node .mini-card.visible {
  transform: translate(-50%, -50%) scale(1);
  opacity: 1;
}

.orbit-node .mini-card .mc-repo {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: #e6edf3;
  overflow: hidden;
  text-overflow: ellipsis;
}

.orbit-node .mini-card .mc-repo-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--node-color, #818cf8);
  flex-shrink: 0;
}

.orbit-node .mini-card .mc-branch {
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  color: #7d8590;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Pulse ripple ── */
@keyframes ripplePulse {
  0% {
    transform: translate(-50%, -50%) scale(0);
    opacity: 0.5;
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0;
  }
}

.pulse-ripple {
  position: absolute;
  width: 500px;
  height: 500px;
  border-radius: 50%;
  border: 1px solid #818cf8;
  pointer-events: none;
  z-index: 2;
  opacity: 0;
}

.pulse-ripple.active {
  animation: ripplePulse 1.2s ease-out forwards;
}

/* ── Stats panel ── */
.stats-panel {
  position: fixed;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: rgba(22, 27, 34, 0.7);
  backdrop-filter: blur(20px) saturate(1.3);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  border: 1px solid #21262d;
  border-radius: 10px;
  font-size: 0.75rem;
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.stats-panel.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.stats-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stats-row .stat-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stats-row .stat-item-label {
  font-size: 0.6875rem;
  color: #7d8590;
}

.stats-row .stat-item-value {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: #e6edf3;
  font-variant-numeric: tabular-nums;
}

.stats-row .stat-divider {
  width: 1px;
  height: 16px;
  background: #21262d;
}

.stats-mini-bar {
  width: 100%;
  height: 3px;
  background: #21262d;
  border-radius: 2px;
  overflow: hidden;
}

.stats-mini-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
  border-radius: 2px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  width: 0%;
}

.repo-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.repo-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #7d8590;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.repo-legend-item.visible {
  opacity: 1;
  transform: translateY(0);
}

.repo-legend-item .legend-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Completion flash ── */
@keyframes completionPulse {
  0% {
    opacity: 0;
  }
  30% {
    opacity: 0.06;
  }
  100% {
    opacity: 0;
  }
}

.completion-flash {
  position: fixed;
  inset: 0;
  background: #818cf8;
  opacity: 0;
  pointer-events: none;
  z-index: 45;
}

.completion-flash.active {
  animation: completionPulse 1s ease-out forwards;
}

/* ── Ambient particles ── */
.ambient-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.ambient-particles :deep(.ambient-particle) {
  position: absolute;
  border-radius: 50%;
  background: #818cf8;
  opacity: 0;
  pointer-events: none;
  animation: particleDrift linear infinite;
}

@keyframes particleDrift {
  0% {
    opacity: 0;
    transform: translate(0, 0);
  }
  15% {
    opacity: 0.1;
  }
  85% {
    opacity: 0.1;
  }
  100% {
    opacity: 0;
    transform: translate(var(--dx), var(--dy));
  }
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .indexing-loading-screen *,
  .indexing-loading-screen *::before,
  .indexing-loading-screen *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }

  .orbit-node {
    will-change: auto;
  }

  .logo-glow {
    display: none;
  }

  .ambient-particles {
    display: none;
  }
}
</style>
