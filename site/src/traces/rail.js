import { clamp, off, RI, svgEl } from "./util.js";

/* =============================== rail =============================== */
export const rail = {
  el: null,
  x: 0,
  on: false,
  reveal: 0,
  endEl: null,
  init(el, endEl) {
    this.el = el;
    this.endEl = endEl;
    return this;
  },
  // place the rail 44px left of the leftmost content edge; hidden if there is no room
  layout(contentLeft) {
    const x = Math.round(contentLeft - 44);
    this.on = window.innerWidth >= 1180 && x >= 26;
    this.x = x;
    document.documentElement.style.setProperty("--rail-x", `${x}px`);
    document.documentElement.classList.toggle("has-rail", this.on);
    this.update();
  },
  lineX(key) {
    return this.x + off(RI[key]);
  },
  setReveal(p) {
    this.reveal = p;
    this.update();
  },
  update() {
    if (!this.el || !this.on) return;
    const vh = window.innerHeight;
    let bottom = (1 - this.reveal) * vh;
    if (this.endEl) bottom = Math.max(bottom, vh - this.endEl.getBoundingClientRect().top);
    bottom = clamp(bottom, 0, vh);
    const v = `inset(0 0 ${bottom.toFixed(1)}px 0)`;
    if (v !== this._clip) {
      this._clip = v;
      this.el.style.clipPath = v;
    }
    const vis = bottom < vh - 0.5;
    if (vis !== this._vis) {
      this._vis = vis;
      this.el.classList.toggle("is-on", vis);
    }
  },
};

/* =============================== branches =============================== */
// a scene-local layer of rail -> UI connectors; coordinates are scene px
export function branchLayer(svg) {
  svg.innerHTML = "";
  const g = svgEl("g", {}, svg);
  return {
    svg,
    g,
    lines: [],
    add(d, color, width, alpha) {
      const grp = svgEl("g", {}, g);
      const halo = svgEl(
        "path",
        {
          d,
          class: "halo",
          "stroke-width": width + 3.2,
          pathLength: 1,
          "stroke-dasharray": "1 1",
          "stroke-dashoffset": 1,
        },
        grp,
      );
      const p = svgEl(
        "path",
        {
          d,
          stroke: color,
          "stroke-width": width,
          "stroke-opacity": alpha || 0.95,
          pathLength: 1,
          "stroke-dasharray": "1 1",
          "stroke-dashoffset": 1,
        },
        grp,
      );
      const dot = svgEl(
        "circle",
        { r: 2.6, fill: color, class: "tip", opacity: 0, style: `color:${color}` },
        grp,
      );
      const line = {
        grp,
        p,
        halo,
        dot,
        len: 0,
        v: -1,
        set(v) {
          v = clamp(v, 0, 1);
          if (v === this.v) return;
          this.v = v;
          const o = (1 - v).toFixed(4);
          p.setAttribute("stroke-dashoffset", o);
          halo.setAttribute("stroke-dashoffset", o);
          if (v > 0.001 && v < 0.999) {
            if (!this.len) this.len = p.getTotalLength();
            const pt = p.getPointAtLength(this.len * v);
            dot.setAttribute("cx", pt.x.toFixed(1));
            dot.setAttribute("cy", pt.y.toFixed(1));
            dot.setAttribute("opacity", 1);
          } else dot.setAttribute("opacity", 0);
        },
      };
      this.lines.push(line);
      return line;
    },
    fade(o) {
      g.setAttribute("opacity", clamp(o, 0, 1).toFixed(3));
    },
  };
}
// rail at (x, yTop) -> rounded elbow -> horizontal run to (x2, y)
export function elbow(x, y, x2, rad, lead) {
  rad = rad || 30;
  lead = lead == null ? 60 : lead;
  return (
    "M" +
    x +
    " " +
    (y - rad - lead) +
    " L" +
    x +
    " " +
    (y - rad) +
    " Q" +
    x +
    " " +
    y +
    " " +
    (x + rad) +
    " " +
    y +
    " L" +
    x2 +
    " " +
    y
  );
}
