import { $, clamp, cubic, hexA, RM, svgEl } from "./util.js";

/* =============================== hero field =============================== */
export function heroField(opts) {
  const host = opts.host,
    eyeEl = opts.eye;
  const base = opts.base,
    top = opts.top;
  const bctx = base.getContext("2d"),
    tctx = top.getContext("2d");
  const COLORS = [
    "#6366f1",
    "#6366f1",
    "#818cf8",
    "#22d3ee",
    "#a78bfa",
    "#f472b6",
    "#fde047",
    "#fbbf24",
  ];
  let W = 0,
    H = 0,
    dpr = 1,
    eye = { x: 0, y: 0, r: 60 },
    traces = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let active = true,
    raf = 0,
    last = 0,
    drawIn = RM ? 1 : 0,
    drawStart = 0,
    converged = false;
  const iris = $(".iris", eyeEl),
    pupil = $(".pupil", eyeEl);
  let energy = 0,
    lastHit = 0;

  function layout() {
    W = host.clientWidth;
    H = opts.height ? opts.height() : host.clientHeight;
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    [base, top].forEach((c) => {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.height = `${H}px`;
    });
    const hr = host.getBoundingClientRect(),
      er = eyeEl.querySelector(".eye-core").getBoundingClientRect();
    eye = {
      x: er.left - hr.left + er.width / 2,
      y: er.top - hr.top + er.height / 2,
      r: er.width / 2,
    };
    seed = 7;
    traces = [];
    const narrow = W < 700;
    const N = narrow ? 16 : W < 1200 ? 26 : 32;
    const band = Math.min(H * 0.62, eye.y + eye.r * 2.6); // keep traces above the headline block
    for (let i = 0; i < N; i++) {
      const r0 = rnd();
      const side = narrow ? (i % 2 ? "L" : "R") : r0 < 0.4 ? "L" : r0 < 0.8 ? "R" : "T";
      let o, c1, c2;
      if (side === "L" || side === "R") {
        const s = side === "L" ? -1 : 1;
        o = { x: side === "L" ? -30 : W + 30, y: band * (0.02 + rnd() * 0.98) };
        c1 = { x: W / 2 + s * W * (0.18 + rnd() * 0.22), y: o.y + (rnd() - 0.5) * 60 };
        c2 = {
          x: eye.x + s * eye.r * (1.8 + rnd() * 1.6),
          y: eye.y + (o.y - eye.y) * (0.05 + rnd() * 0.3),
        };
      } else {
        o = { x: eye.x + (rnd() - 0.5) * W * 0.6, y: -30 };
        c1 = { x: o.x + (rnd() - 0.5) * 160, y: eye.y * 0.35 };
        c2 = { x: eye.x + (o.x - eye.x) * 0.18, y: eye.y - eye.r * (1.5 + rnd()) };
      }
      let dx = eye.x - c2.x,
        dy = eye.y - c2.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const end = { x: eye.x - dx * eye.r * 1.02, y: eye.y - dy * eye.r * 1.02 };
      const f = cubic(o, c1, c2, end);
      const n = 64,
        pts = new Float32Array((n + 1) * 2);
      for (let k = 0; k <= n; k++) {
        const p = f(k / n);
        pts[k * 2] = p.x * dpr;
        pts[k * 2 + 1] = p.y * dpr;
      }
      const color = COLORS[Math.floor(rnd() * COLORS.length)];
      const a1 = 0.14 + rnd() * 0.16;
      const grad = bctx.createLinearGradient(o.x * dpr, o.y * dpr, end.x * dpr, end.y * dpr);
      grad.addColorStop(0, hexA(color, 0));
      grad.addColorStop(0.55, hexA(color, a1 * 0.55));
      grad.addColorStop(1, hexA(color, a1 + 0.14));
      traces.push({
        pts,
        n,
        color,
        grad,
        delay: rnd() * 0.35,
        dur: 0.8 + rnd() * 0.4,
        pulse: -rnd() * 1.4,
        pspeed: 0.16 + rnd() * 0.16,
        plen: 0.07 + rnd() * 0.05,
      });
    }
    drawBase(drawIn >= 1 ? 99 : 0);
  }
  function poly(ctx, tr, k0, k1) {
    const p = tr.pts;
    ctx.beginPath();
    ctx.moveTo(p[k0 * 2], p[k0 * 2 + 1]);
    for (let k = k0 + 1; k <= k1; k++) ctx.lineTo(p[k * 2], p[k * 2 + 1]);
  }
  // draws the static geometry; t is seconds into the draw-in (99 = complete)
  function drawBase(t) {
    bctx.clearRect(0, 0, base.width, base.height);
    bctx.lineCap = "round";
    bctx.lineJoin = "round";
    bctx.lineWidth = 1 * dpr;
    let all = true;
    for (const tr of traces) {
      const prog = clamp((t - tr.delay) / tr.dur, 0, 1);
      if (prog < 1) all = false;
      if (prog <= 0) continue;
      const e = 1 - (1 - prog) ** 3;
      bctx.strokeStyle = tr.grad;
      poly(bctx, tr, 0, Math.max(1, Math.round(e * tr.n)));
      bctx.stroke();
    }
    return all;
  }
  function frame(now) {
    raf = 0;
    if (!active) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    if (drawIn < 1) {
      const t = (now - drawStart) / 1000;
      if (drawBase(t)) {
        drawIn = 1;
        if (!converged) {
          converged = true;
          opts.onConverged?.();
        }
      }
    }
    tctx.clearRect(0, 0, top.width, top.height);
    if (drawIn >= 1) {
      tctx.globalCompositeOperation = "lighter";
      tctx.lineCap = "round";
      tctx.lineWidth = 1.6 * dpr;
      for (const tr of traces) {
        tr.pulse += tr.pspeed * dt;
        if (tr.pulse > 1 + tr.plen + 0.2) tr.pulse = -0.3 - Math.random() * 1.2;
        const a = tr.pulse - tr.plen,
          b = tr.pulse;
        if (b <= 0 || a >= 1) continue;
        const ka = Math.max(0, Math.floor(a * tr.n)),
          kb = Math.min(tr.n, Math.ceil(b * tr.n));
        if (kb <= ka) continue;
        tctx.strokeStyle = hexA(tr.color, 0.6 * Math.min(1, b * 3));
        poly(tctx, tr, ka, kb);
        tctx.stroke();
        if (b >= 1 && now - lastHit > 140) {
          energy = Math.min(1, energy + 0.35);
          lastHit = now;
        }
      }
      tctx.globalCompositeOperation = "source-over";
    }
    if (energy > 0.01 || energy !== 0) {
      energy *= 0.93;
      if (energy < 0.01) energy = 0;
      if (iris) iris.style.strokeOpacity = (0.75 + energy * 0.25).toFixed(3);
      if (pupil)
        pupil.style.fill = energy
          ? `rgb(${Math.round(99 + 60 * energy)},${Math.round(102 + 60 * energy)},241)`
          : "";
    }
    raf = requestAnimationFrame(frame);
  }
  function setActive(v) {
    v = !!v && !RM;
    if (v === active) return;
    active = v;
    if (active && !raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    if (!active && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  layout();
  if (RM) {
    drawBase(99);
    return { layout, setActive() {} };
  }
  drawStart = performance.now() + (opts.delay || 0) * 1000;
  raf = requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (active && !raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  });
  return { layout, setActive };
}

export function buildDial(g) {
  if (!g || g.childNodes.length) return;
  svgEl("circle", { r: 168 }, g);
  svgEl("circle", { r: 186 }, g);
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2,
      major = i % 10 === 0;
    const r0 = 172,
      r1 = major ? 184 : 177;
    svgEl(
      "line",
      {
        x1: (Math.cos(a) * r0).toFixed(2),
        y1: (Math.sin(a) * r0).toFixed(2),
        x2: (Math.cos(a) * r1).toFixed(2),
        y2: (Math.sin(a) * r1).toFixed(2),
        class: major ? "major" : "",
      },
      g,
    );
  }
}
