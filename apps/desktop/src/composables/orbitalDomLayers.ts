/**
 * Lane-ellipse SVG layer + ambient-particle DOM helpers for the orbital
 * animation. Extracted so the controller composable stays focused on state
 * and the frame loop.
 */

import { getSemanticColors } from "@/utils/designTokens";
import { ellipseCircumference, LANES } from "@/utils/orbitalGeometry";

export interface LaneEllipseLayer {
  draw(): void;
  show(): void;
  setOpacity(opacity: string): void;
  updatePositions(): void;
  brightenBriefly(): void;
  clear(): void;
}

export interface LaneEllipseDeps {
  svgRef: { value: SVGSVGElement | undefined };
  getCenter: () => { x: number; y: number };
  getScale: () => number;
}

export function createLaneEllipseLayer(deps: LaneEllipseDeps): LaneEllipseLayer {
  let laneEllipses: SVGEllipseElement[] = [];

  function draw() {
    const svg = deps.svgRef.value;
    if (!svg) return;

    laneEllipses.forEach((el) => {
      el.remove();
    });
    laneEllipses = [];

    LANES.forEach((lane) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      const s = deps.getScale();
      const { x: cx, y: cy } = deps.getCenter();
      el.setAttribute("cx", String(cx));
      el.setAttribute("cy", String(cy));
      el.setAttribute("rx", String(lane.rx * s));
      el.setAttribute("ry", String(lane.ry * s));
      el.setAttribute("stroke", getSemanticColors().accentEmphasis);
      el.setAttribute("stroke-opacity", "0");
      el.setAttribute("stroke-width", "1");
      el.setAttribute("fill", "none");
      el.setAttribute("transform", `rotate(${lane.tiltDeg} ${cx} ${cy})`);

      // Stroke-dash draw-in effect
      const circumference = ellipseCircumference(lane, s);
      el.setAttribute("stroke-dasharray", String(circumference));
      el.setAttribute("stroke-dashoffset", String(circumference));
      el.style.transition =
        "stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1), stroke-opacity 0.8s ease";

      svg.appendChild(el);
      laneEllipses.push(el);
    });
  }

  function show() {
    laneEllipses.forEach((el, i) => {
      setTimeout(() => {
        el.setAttribute("stroke-opacity", "0.12");
        el.setAttribute("stroke-dashoffset", "0");
      }, i * 300);
    });
  }

  function setOpacity(opacity: string) {
    laneEllipses.forEach((el) => {
      el.setAttribute("stroke-opacity", opacity);
    });
  }

  function updatePositions() {
    laneEllipses.forEach((el, i) => {
      const lane = LANES[i];
      const s = deps.getScale();
      const { x: cx, y: cy } = deps.getCenter();
      el.setAttribute("cx", String(cx));
      el.setAttribute("cy", String(cy));
      el.setAttribute("rx", String(lane.rx * s));
      el.setAttribute("ry", String(lane.ry * s));
      el.setAttribute("transform", `rotate(${lane.tiltDeg} ${cx} ${cy})`);
      el.setAttribute("stroke-dasharray", String(ellipseCircumference(lane, s)));
    });
  }

  function brightenBriefly() {
    laneEllipses.forEach((el) => {
      el.setAttribute("stroke-opacity", "0.25");
      setTimeout(() => el.setAttribute("stroke-opacity", "0.12"), 600);
    });
  }

  function clear() {
    laneEllipses.forEach((el) => {
      el.remove();
    });
    laneEllipses = [];
  }

  return { draw, show, setOpacity, updatePositions, brightenBriefly, clear };
}

/** Spawn `count` ambient particle elements into the container. */
export function createAmbientParticles(
  container: HTMLElement | undefined,
  count: number,
  reducedMotion: boolean,
) {
  if (!container) return;
  container.replaceChildren();
  if (reducedMotion) return;

  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "ambient-particle";
    const size = 1 + Math.random() * 1.5;
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const dx = (Math.random() - 0.5) * 60;
    const dy = (Math.random() - 0.5) * 60;
    const dur = 20 + Math.random() * 30;
    const delay = Math.random() * dur;
    p.style.cssText = `
        width:${size}px; height:${size}px;
        left:${x}%; top:${y}%;
        --dx:${dx}px; --dy:${dy}px;
        animation-duration:${dur}s;
        animation-delay:-${delay}s;
      `;
    container.appendChild(p);
  }
}
