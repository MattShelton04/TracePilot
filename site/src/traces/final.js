import { gsap } from "../lib/gsap.js";
import { rail } from "./rail.js";
import { clamp, off, RAIL, RM, svgEl } from "./util.js";

/* =============================== final convergence =============================== */
export function finalTraces(svg, section, eyeEl) {
  const lines = [];
  let span = 1;
  function layout() {
    svg.innerHTML = "";
    lines.length = 0;
    if (!rail.on) return;
    const sr = section.getBoundingClientRect(),
      er = eyeEl.getBoundingClientRect();
    const W = sr.width,
      H = section.offsetHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    const ex = er.left - sr.left + er.width / 2,
      ey = er.top - sr.top + er.height / 2,
      r = er.width * 0.42;
    RAIL.forEach((rl, i) => {
      const x = rail.x + off(i);
      const ty = ey + (i - 2.5) * 7;
      const ex2 = ex - r * Math.cos(Math.asin(clamp((ty - ey) / r, -0.9, 0.9)));
      const yA = ey - 150 + i * 4;
      const d =
        "M" +
        x +
        " 0 L" +
        x +
        " " +
        yA.toFixed(1) +
        " C" +
        x +
        " " +
        (ty - 30).toFixed(1) +
        " " +
        (x + 90) +
        " " +
        ty.toFixed(1) +
        " " +
        (x + 220) +
        " " +
        ty.toFixed(1) +
        " L" +
        (ex2 - 70).toFixed(1) +
        " " +
        ty.toFixed(1) +
        " Q" +
        (ex2 - 30).toFixed(1) +
        " " +
        ty.toFixed(1) +
        " " +
        ex2.toFixed(1) +
        " " +
        (ey + (ty - ey) * 0.4).toFixed(1);
      const p = svgEl(
        "path",
        {
          d,
          stroke: rl.c,
          "stroke-width": 1.25,
          "stroke-opacity": 0.85,
          pathLength: 1,
          "stroke-dasharray": "1 1",
          "stroke-dashoffset": 1,
        },
        svg,
      );
      lines.push(p);
    });
    span = 1;
  }
  let blinked = false;
  function update() {
    if (!lines.length) return;
    const vh = window.innerHeight;
    const top = section.getBoundingClientRect().top;
    const docTop = top + window.scrollY;
    const maxScroll = document.documentElement.scrollHeight - vh;
    const endTop = Math.max(docTop - maxScroll, vh * 0.05 - section.offsetHeight * 0.1);
    span = Math.max(120, vh - endTop);
    const p = RM ? 1 : clamp((vh - top) / span, 0, 1);
    const o = (1 - p).toFixed(4);
    lines.forEach((l) => {
      l.setAttribute("stroke-dashoffset", o);
    });
    if (p > 0.97 && !blinked) {
      blinked = true;
      if (!RM)
        gsap
          .timeline()
          .to(eyeEl.querySelector(".lid"), {
            scaleY: 0.1,
            duration: 0.11,
            ease: "power2.in",
            transformOrigin: "50% 50%",
          })
          .to(eyeEl.querySelector(".lid"), { scaleY: 1, duration: 0.26, ease: "power3.out" });
    }
    if (p < 0.6) blinked = false;
  }
  return { layout, update };
}
