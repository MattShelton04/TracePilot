/**
 * Pure orbital-animation geometry + layout helpers.
 *
 * Extracted from `useOrbitalAnimation` so the math can be reasoned about and
 * tested without a DOM. Nothing here reads or writes DOM state — the
 * animation controller wires the outputs into SVG / HTML elements.
 *
 * Coordinates follow the SVG convention: +x right, +y down, origin top-left.
 * Every "angle" is in radians, every "tilt" is in degrees (converted locally).
 */

import { getChartColors } from "@/utils/designTokens";

// ── Lane definitions ───────────────────────────────────────────────────────

export const LANES = [
  { rx: 150, ry: 100, period: 12, tiltDeg: 15, tokenMax: 30_000 },
  { rx: 250, ry: 165, period: 20, tiltDeg: -10, tokenMax: 100_000 },
  { rx: 360, ry: 235, period: 30, tiltDeg: 8, tokenMax: Infinity },
] as const;

export interface OrbitLane {
  readonly rx: number;
  readonly ry: number;
  readonly period: number;
  readonly tiltDeg: number;
  readonly tokenMax: number;
}

// ── Animation budget constants ─────────────────────────────────────────────

export const MAX_VISIBLE_NODES = 40;
export const MAX_CONNECTIONS = 80;

// Muted dark gray for decorative seed nodes — intentionally distinct from the
// repo color palette and kept outside the token system.
export const SEED_COLOR = "#4b5563";

// ── Phase / UI labels ──────────────────────────────────────────────────────

export type Phase = "idle" | "discovering" | "indexing" | "finalizing" | "complete";

export const PHASE_LABELS: Record<Phase, string> = {
  idle: "Preparing…",
  discovering: "Discovering sessions…", // Cycled in component
  indexing: "Indexing sessions…",
  finalizing: "Building search index…",
  complete: "Ready — launching TracePilot",
};

export const DISCOVERING_MESSAGES = [
  "Discovering sessions…",
  "Scanning workspace…",
  "Loading session data…",
  "Analyzing conversation history…",
];

// ── Repo color palette ─────────────────────────────────────────────────────

/**
 * Repository color palette derived from design tokens.
 * Uses semantic chart colors to ensure consistency and theme support.
 */
export function getRepoPalette(): string[] {
  const colors = getChartColors();
  return [
    colors.primaryLight, // indigo
    colors.success, // emerald
    colors.warning, // amber
    colors.danger, // rose
    colors.secondary, // violet
    colors.info, // sky blue
    colors.orange, // orange
  ];
}

// ── Pure geometry helpers ──────────────────────────────────────────────────

/**
 * Map an angle on the given lane to screen (x, y).
 *
 * Applies the per-lane tilt (rotation about the centre) and the global
 * viewport scale factor.
 */
export function computeOrbitalPos(
  angle: number,
  lane: OrbitLane,
  centerX: number,
  centerY: number,
  scale: number,
): { x: number; y: number } {
  const tiltRad = (lane.tiltDeg * Math.PI) / 180;
  const ex = lane.rx * scale * Math.cos(angle);
  const ey = lane.ry * scale * Math.sin(angle);
  return {
    x: centerX + ex * Math.cos(tiltRad) - ey * Math.sin(tiltRad),
    y: centerY + ex * Math.sin(tiltRad) + ey * Math.cos(tiltRad),
  };
}

/** Fit token usage into the lane whose `tokenMax` accommodates it. */
export function assignLane(tokens: number, lanes: readonly OrbitLane[] = LANES): number {
  for (let i = 0; i < lanes.length; i++) {
    if (tokens <= lanes[i].tokenMax) return i;
  }
  return lanes.length - 1;
}

/**
 * Middle-ellipsis truncation: preserves a short prefix + suffix so repo and
 * branch names still look recognisable when squeezed.
 */
export function truncateMiddle(str: string, max: number): string {
  if (str.length <= max) return str;
  const ellipsis = "…";
  const budget = max - ellipsis.length;
  const endLen = Math.ceil(budget * 0.6);
  const startLen = budget - endLen;
  return str.slice(0, startLen) + ellipsis + str.slice(-endLen);
}

/** Approximate ellipse circumference used for stroke-dasharray draw-in. */
export function ellipseCircumference(lane: OrbitLane, scale: number): number {
  return Math.PI * 2 * Math.max(lane.rx, lane.ry) * scale;
}

/**
 * Clamp the dynamic viewport scale so the lanes never grow beyond the design
 * intent, regardless of how large the user's window is.
 */
export function computeScaleFactor(fieldW: number, fieldH: number): number {
  return Math.min(1.35, Math.min(fieldW / 960, fieldH / 640));
}

/** Angular speed (radians/sec) for a lane's canonical orbital period. */
export function angularSpeedFor(lane: OrbitLane): number {
  return (Math.PI * 2) / lane.period;
}

/** Random starting angle in radians, uniformly distributed across the orbit. */
export function randomStartAngle(random: () => number = Math.random): number {
  return random() * Math.PI * 2;
}

/**
 * Per-node speed jitter so identical lanes don't drift in lockstep.
 * Returns a value in `[0.85, 1.15)` — preserved byte-for-byte from the
 * original `useOrbitalAnimation` implementation.
 */
export function speedJitter(random: () => number = Math.random): number {
  return 0.85 + random() * 0.3;
}
