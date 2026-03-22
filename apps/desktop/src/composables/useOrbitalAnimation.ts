import { ref, reactive, computed, type Ref } from 'vue'

// ── Types ──────────────────────────────────────────────────────────────────────

export type Phase = 'idle' | 'discovering' | 'indexing' | 'finalizing' | 'complete'

export interface OrbitNode {
  id: number
  repo: string
  repoDisplay: string
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

export interface RepoLegendItem {
  name: string
  displayName: string
  color: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

export const LANES = [
  { rx: 150, ry: 100, period: 12, tiltDeg: 15, tokenMax: 30_000 },
  { rx: 250, ry: 165, period: 20, tiltDeg: -10, tokenMax: 100_000 },
  { rx: 360, ry: 235, period: 30, tiltDeg: 8, tokenMax: Infinity },
] as const

const REPO_PALETTE = [
  '#818cf8', '#34d399', '#fbbf24', '#f87171',
  '#a78bfa', '#38bdf8', '#fb923c',
]

export const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Preparing…',
  discovering: 'Discovering sessions…',
  indexing: 'Indexing sessions…',
  finalizing: 'Building search index…',
  complete: 'Ready — launching TracePilot',
}

const MAX_VISIBLE_NODES = 40
const MAX_CONNECTIONS = 80

// ── Composable options ─────────────────────────────────────────────────────────

export interface OrbitalAnimationOptions {
  orbitalFieldRef: Ref<HTMLElement | undefined>
  svgLayerRef: Ref<SVGSVGElement | undefined>
  ambientContainerRef: Ref<HTMLElement | undefined>
  phase: Ref<Phase>
  prefersReducedMotion: Ref<boolean>
  /** Called on every animation frame (use for counter lerp, etc.) */
  onFrame?: () => void
}

/**
 * Full orbital animation engine for the indexing loading screen.
 *
 * - Manages orbiting nodes, SVG connections, lane ellipses, ambient particles, and pulse ripples
 * - Provides a requestAnimationFrame-based animation loop
 * - Handles viewport measurement and resize
 * - All DOM elements are cleaned up via `stop()`
 */
export function useOrbitalAnimation(options: OrbitalAnimationOptions) {
  const {
    orbitalFieldRef,
    svgLayerRef,
    ambientContainerRef,
    phase,
    prefersReducedMotion,
    onFrame,
  } = options

  // ── Reactive state ───────────────────────────────────────────────────────────

  const nodes = reactive<OrbitNode[]>([])
  const connections: Connection[] = []
  const ripples = ref<Ripple[]>([])
  const repoLegendItems = ref<RepoLegendItem[]>([])
  const centerX = ref(0)
  const centerY = ref(0)
  const scaleFactor = ref(1)

  // ── Internal state ───────────────────────────────────────────────────────────

  let nodeIdCounter = 0
  let rippleIdCounter = 0
  let animFrameId = 0
  let lastTimestamp = 0
  let globalSpeedMult = 1
  let animating = false
  let laneEllipses: SVGEllipseElement[] = []
  let resizeObserver: ResizeObserver | null = null
  let fieldW = 0
  let fieldH = 0

  const repoColorMap = new Map<string, string>()
  let nextColorIndex = 0

  const pendingTimers = new Set<ReturnType<typeof setTimeout>>()

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function safeTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      pendingTimers.delete(id)
      fn()
    }, ms)
    pendingTimers.add(id)
    return id
  }

  function truncateMiddle(str: string, max: number): string {
    if (str.length <= max) return str
    const ellipsis = '…'
    const budget = max - ellipsis.length
    const endLen = Math.ceil(budget * 0.6)
    const startLen = budget - endLen
    return str.slice(0, startLen) + ellipsis + str.slice(-endLen)
  }

  function getRepoColor(repo: string): string {
    let color = repoColorMap.get(repo)
    if (!color) {
      color = REPO_PALETTE[nextColorIndex % REPO_PALETTE.length]
      nextColorIndex++
      repoColorMap.set(repo, color)
      repoLegendItems.value.push({ name: repo, displayName: truncateMiddle(repo, 36), color })
    }
    return color
  }

  function assignLane(tokens: number): number {
    for (let i = 0; i < LANES.length; i++) {
      if (tokens <= LANES[i].tokenMax) return i
    }
    return LANES.length - 1
  }

  /** Compute (x, y) on a tilted elliptical orbit, scaled to viewport. */
  function getOrbitalPos(angle: number, laneIdx: number): { x: number; y: number } {
    const lane = LANES[laneIdx]
    const s = scaleFactor.value
    const tiltRad = (lane.tiltDeg * Math.PI) / 180
    const ex = lane.rx * s * Math.cos(angle)
    const ey = lane.ry * s * Math.sin(angle)
    return {
      x: centerX.value + ex * Math.cos(tiltRad) - ey * Math.sin(tiltRad),
      y: centerY.value + ex * Math.sin(tiltRad) + ey * Math.cos(tiltRad),
    }
  }

  // ── Viewport measurement ─────────────────────────────────────────────────────

  function measureField() {
    const el = orbitalFieldRef.value
    if (!el) return
    fieldW = el.clientWidth
    fieldH = el.clientHeight
    centerX.value = fieldW / 2
    centerY.value = fieldH / 2
    scaleFactor.value = Math.min(1.35, Math.min(fieldW / 960, fieldH / 640))
    svgLayerRef.value?.setAttribute('viewBox', `0 0 ${fieldW} ${fieldH}`)
    updateLaneEllipsePositions()
  }

  // ── Ambient particles ────────────────────────────────────────────────────────

  function createAmbientParticles(count: number) {
    const container = ambientContainerRef.value
    if (!container) return
    container.replaceChildren()

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

  // ── SVG orbital ellipses ─────────────────────────────────────────────────────

  function drawLaneEllipses() {
    const svg = svgLayerRef.value
    if (!svg) return

    laneEllipses.forEach((el) => el.remove())
    laneEllipses = []

    LANES.forEach((lane) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
      const s = scaleFactor.value
      el.setAttribute('cx', String(centerX.value))
      el.setAttribute('cy', String(centerY.value))
      el.setAttribute('rx', String(lane.rx * s))
      el.setAttribute('ry', String(lane.ry * s))
      el.setAttribute('stroke', '#6366f1')
      el.setAttribute('stroke-opacity', '0')
      el.setAttribute('stroke-width', '1')
      el.setAttribute('fill', 'none')
      el.setAttribute('transform', `rotate(${lane.tiltDeg} ${centerX.value} ${centerY.value})`)

      // Stroke-dash draw-in effect
      const circumference = Math.PI * 2 * Math.max(lane.rx, lane.ry) * s
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

  function setLaneEllipseOpacity(opacity: string) {
    laneEllipses.forEach((el) => el.setAttribute('stroke-opacity', opacity))
  }

  function updateLaneEllipsePositions() {
    laneEllipses.forEach((el, i) => {
      const lane = LANES[i]
      const s = scaleFactor.value
      el.setAttribute('cx', String(centerX.value))
      el.setAttribute('cy', String(centerY.value))
      el.setAttribute('rx', String(lane.rx * s))
      el.setAttribute('ry', String(lane.ry * s))
      el.setAttribute('transform', `rotate(${lane.tiltDeg} ${centerX.value} ${centerY.value})`)
      const circumference = Math.PI * 2 * Math.max(lane.rx, lane.ry) * s
      el.setAttribute('stroke-dasharray', String(circumference))
    })
  }

  // ── Node creation ────────────────────────────────────────────────────────────

  function createNode(repo: string, branch: string, tokens: number): OrbitNode {
    const laneIdx = assignLane(tokens)
    const color = getRepoColor(repo)
    const startAngle = Math.random() * Math.PI * 2
    const speedJitter = 0.85 + Math.random() * 0.3
    const pos = getOrbitalPos(startAngle, laneIdx)

    const node: OrbitNode = {
      id: nodeIdCounter++,
      repo,
      repoDisplay: truncateMiddle(repo, 28),
      branch,
      branchDisplay: truncateMiddle(branch, 18),
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

  // ── Connections ──────────────────────────────────────────────────────────────

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

  // ── Pulse ripple ─────────────────────────────────────────────────────────────

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

  // ── Animation loop ───────────────────────────────────────────────────────────

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

    onFrame?.()

    animFrameId = requestAnimationFrame(animate)
  }

  /** Start the animation loop and resize observer. */
  function start() {
    animating = true
    lastTimestamp = 0
    animFrameId = requestAnimationFrame(animate)

    resizeObserver = new ResizeObserver(() => measureField())
    if (orbitalFieldRef.value) {
      resizeObserver.observe(orbitalFieldRef.value)
    }
  }

  /** Stop the animation loop and clean up all DOM resources. */
  function stop() {
    animating = false
    if (animFrameId) {
      cancelAnimationFrame(animFrameId)
      animFrameId = 0
    }

    for (const id of pendingTimers) clearTimeout(id)
    pendingTimers.clear()

    resizeObserver?.disconnect()
    resizeObserver = null

    connections.forEach((c) => c.el.remove())
    connections.length = 0
    laneEllipses.forEach((el) => el.remove())
    laneEllipses = []
  }

  function setGlobalSpeedMult(value: number) {
    globalSpeedMult = value
  }

  /** Smoothly decelerate orbits over the given duration. */
  function decelerate(durationMs = 300) {
    if (prefersReducedMotion.value) {
      globalSpeedMult = 0
      return
    }

    const decStart = performance.now()
    function step() {
      const t = Math.min((performance.now() - decStart) / durationMs, 1)
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

      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  // ── Computed ─────────────────────────────────────────────────────────────────

  const visibleNodes = computed(() => {
    if (nodes.length <= MAX_VISIBLE_NODES) return nodes
    return nodes.slice(nodes.length - MAX_VISIBLE_NODES)
  })

  return {
    // Reactive state
    nodes,
    visibleNodes,
    ripples,
    repoLegendItems,
    centerX,
    centerY,
    scaleFactor,

    // Methods
    createNode,
    emitPulse,
    measureField,
    createAmbientParticles,
    drawLaneEllipses,
    showLaneEllipses,
    setLaneEllipseOpacity,
    setGlobalSpeedMult,
    start,
    stop,
    decelerate,
  }
}
