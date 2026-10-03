import { D } from "../data.js";
import { fmtAic, fmtInt, fmtUsd } from "../lib/format.js";
import { ic } from "./icons.js";
import {
  chipsFor,
  crumbs,
  dur,
  esc,
  fmtK,
  placeHighlight,
  placeInk,
  shell,
  tabsHTML,
} from "./shell.js";

/* ---------- 4. Context + Metrics window ---------- */
export const CTX = (() => {
  const pts = D.heroContextTimeline.points;
  const mm = D.heroMetrics.modelMetrics;
  const models = Object.keys(mm).map((k) => ({
    k,
    input: mm[k].usage.inputTokens,
    out: mm[k].usage.outputTokens,
    cache: mm[k].usage.cacheReadTokens,
  }));
  const input = models.reduce((a, m) => a + m.input, 0),
    cache = models.reduce((a, m) => a + m.cache, 0),
    out = models.reduce((a, m) => a + m.out, 0);
  const totalTok = input + out;
  const dist = models.map((m) => ({
    k: m.k,
    tok: m.input + m.out,
    pct: ((m.input + m.out) / totalTok) * 100,
  }));
  return {
    pts,
    input,
    cache,
    totalTok,
    dist,
    hitRate: (cache / input) * 100,
    notServed: input - cache,
  };
})();

export function buildContext(win) {
  const H = D.heroDetail;
  const TL = D.heroContextTimeline;
  // chart geometry
  const CW = 1124,
    CH = 330,
    L = 52,
    R = 18,
    T = 26,
    B = 26;
  const pw = CW - L - R,
    ph = CH - T - B;
  const X = (turn) => L + (turn / 11) * pw;
  const Y = (tok) => T + ph - (tok / 200000) * ph;
  const pts = CTX.pts.map((p) => ({
    x: X(p.turn),
    sys: p.systemTokens,
    tool: p.toolDefinitionTokens,
    tot: p.totalTokens,
    phase: p.phase,
    turn: p.turn,
  }));
  const line = (fn) =>
    pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${Y(fn(p)).toFixed(1)}`).join(" ");
  const back = (fn) =>
    pts
      .slice()
      .reverse()
      .map((p) => `L${p.x.toFixed(1)} ${Y(fn(p)).toFixed(1)}`)
      .join(" ");
  const area = (top, bot) => `${line(top)} ${back(bot)} Z`;
  const sysA = area(
      (p) => p.sys,
      () => 0,
    ),
    toolA = area(
      (p) => p.sys + p.tool,
      (p) => p.sys,
    ),
    convA = area(
      (p) => p.tot,
      (p) => p.sys + p.tool,
    );
  const grid = [0, 50000, 100000, 150000, 200000]
    .map(
      (v) =>
        `<line x1="${L}" x2="${CW - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.05)"/><text x="${L - 10}" y="${Y(v) + 4}" text-anchor="end">${v ? `${v / 1000}k` : 0}</text>`,
    )
    .join("");
  const turns = Array.from(
    { length: 12 },
    (_, i) =>
      `<circle class="tdot" data-t="${i}" cx="${X(i)}" cy="${Y(12140)}" r="5.5" fill="#0b0b0e" stroke="#818cf8" stroke-width="2"/>`,
  ).join("");
  const xl = Array.from(
    { length: 12 },
    (_, i) =>
      `<text x="${X(i)}" y="${CH - 6}" text-anchor="middle" style="font-size:10px">${i}</text>`,
  ).join("");
  const cx = X(8);
  const svg = `<svg class="chart-svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">
    <defs><clipPath id="ctxClip"><rect class="clip-r" x="${L}" y="0" width="${pw + 2}" height="${CH}"/></clipPath></defs>
    ${grid}
    <line x1="${L}" x2="${CW - R}" y1="${Y(200000)}" y2="${Y(200000)}" stroke="#fb7185" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round"/>
    <line x1="${L}" x2="${CW - R}" y1="${Y(D.compaction.before)}" y2="${Y(D.compaction.before)}" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round"/>
    <text class="lab" x="${L + 10}" y="${Y(200000) - 7}">Reported truncation limit · 200k</text>
    <text class="lab" x="${L + 10}" y="${Y(D.compaction.before) + 16}">Observed compaction median · ${fmtK(D.compaction.before).toLowerCase()}</text>
    <g clip-path="url(#ctxClip)">
      <path d="${convA}" fill="#fbbf24" fill-opacity=".72"/>
      <path d="${toolA}" fill="#6366f1" fill-opacity=".9"/>
      <path d="${sysA}" fill="#a78bfa" fill-opacity=".85"/>
      <path d="${line((p) => p.tot)}" fill="none" stroke="#fde68a" stroke-opacity=".6" stroke-width="1.2"/>
      ${turns}
    </g>
    <g class="cliff" opacity="0"><line x1="${cx}" x2="${cx}" y1="${Y(200000)}" y2="${Y(0)}" stroke="#fb7185" stroke-width="1.5" stroke-dasharray="4 4"/>
      <circle cx="${cx}" cy="${Y(182980)}" r="5" fill="#0b0b0e" stroke="#fb7185" stroke-width="2"/></g>
    <circle class="pulse" cx="${cx}" cy="${Y(182980)}" r="10" fill="none" stroke="#fb7185" stroke-width="2" opacity="0"/>
    <line class="playhead" x1="0" x2="0" y1="${T - 4}" y2="${Y(0)}" stroke="rgba(250,250,250,.5)" stroke-width="1"/>
    ${xl}
  </svg>`;
  const metrics = `
    <div class="metrics" style="position:absolute;left:24px;right:24px;top:${0}px">
      <div class="tiles t4" style="margin-top:18px">
        <div class="stile panel"><span class="v v-indigo" data-count-to="${D.costs.hero.aic}" data-fmt="aic">${fmtAic(D.costs.hero.aic)}</span><span class="l">AI Credits (estimate)</span></div>
        <div class="stile panel"><span class="v v-indigo" data-count-to="${D.costs.hero.usd}" data-fmt="usd">${fmtUsd(D.costs.hero.usd)}</span><span class="l">AIC USD equivalent</span></div>
        <div class="stile panel"><span class="v v-violet" data-count-to="${CTX.totalTok}" data-fmt="k">${fmtK(CTX.totalTok)}</span><span class="l">Total Tokens</span></div>
        <div class="stile panel"><span class="v v-violet" data-count-to="${D.heroMetrics.totalApiDurationMs / 1000}" data-fmt="dur">${dur(D.heroMetrics.totalApiDurationMs)}</span><span class="l">API Duration</span></div>
      </div>
      <div class="met-note">Estimated from GitHub token rates</div>
      <div class="met-toggle"><span class="on">By model</span><span>By agent</span></div>
      <div class="panel" style="margin-top:12px"><div class="panel-h">Cache breakdown<span style="margin-left:auto;letter-spacing:0;text-transform:none;font-weight:600;color:var(--text-secondary)">All models</span></div>
        <div class="cache-body"><div class="ring"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - CTX.hitRate}"/></svg>
          <div class="ring-c"><b data-count-to="${CTX.hitRate.toFixed(1)}" data-fmt="pct">${CTX.hitRate.toFixed(1)}%</b><small>cache read</small></div></div>
          <div class="cache-bars"><div class="row"><span>Read from cache</span><span>Not served from cache</span></div>
            <div class="vals"><span class="g">${fmtK(CTX.cache)}</span><span>${fmtK(CTX.notServed)}</span></div>
            <div class="track"><i class="cache-fill" style="transform:scaleX(${(CTX.hitRate / 100).toFixed(3)})"></i></div><div class="foot">${fmtK(CTX.input)} input tokens</div></div></div></div>
      <div class="panel" style="margin-top:14px"><div class="panel-h">Token distribution</div><div class="dist">
        ${CTX.dist.map((d) => `<div class="drow"><span>${d.k}</span><span class="track"><i style="transform:scaleX(${(d.pct / 100).toFixed(3)})"></i></span><span class="n">${fmtK(d.tok)}</span><span class="n">${d.pct.toFixed(1)}%</span></div>`).join("")}
      </div></div>
    </div>`;
  const main = `
    <div class="crumb"><span style="display:contents" class="crumb-ctx">${crumbs("Sessions", esc(H.summary), "Context")}</span>
      <span class="crumb-alt crumb-met" style="opacity:0;background:#0e0e11">${crumbs("Sessions", esc(H.summary), "Metrics")}</span></div>
    <div class="content" style="padding-top:14px">
      <div style="display:flex;align-items:center;gap:12px"><h1 class="dv-title" style="font-size:19px">${esc(H.summary)}</h1><div class="dv-chips" style="margin:0">${chipsFor(H)}</div>
        <span style="margin-left:auto" class="cache-chip">${ic("timer")}<span class="cache-label">Cache expiring</span> · <span class="cache-time">3:45</span></span></div>
      <div style="margin-top:10px">${tabsHTML("context")}</div>
      <div class="ctx-pane" style="position:absolute;left:24px;right:24px;top:${14 + 30 + 10 + 38}px">
        <div class="ctx-top"><span class="l">${ic("info")}How estimates work</span><span class="r"><span class="ochip">${TL.observedPointCount} observed</span><span class="ochip am">${TL.estimatedPointCount} estimated</span><span class="ochip gr">${TL.pairedCompactionCount}/${TL.compactionCompleteCount} paired</span></span></div>
        <div class="tiles t4 ctx-tiles" style="margin-top:10px">
          <div class="stile panel"><span class="v v-indigo" data-ctx="peak">0</span><span class="l">Peak Context</span></div>
          <div class="stile panel"><span class="v v-violet" data-ctx="latest">0</span><span class="l">Latest Context</span></div>
          <div class="stile panel"><span class="v v-amber" data-ctx="comp">0</span><span class="l">Compactions</span></div>
          <div class="stile panel cost-tile"><span class="v v-green"><span data-ctx="aic">0.0</span> <small>AIC</small><em data-ctx="usd">$0.00</em></span><span class="l">AI Credits so far (estimate)</span><i class="cost-bar"><i data-ctx="costbar"></i></i></div>
        </div>
        <div class="panel ctx-chart"><div class="panel-h">Context pressure by turn</div>
          <div class="legend2"><span class="lchip"><i style="background:#a78bfa"></i>System prompt</span><span class="lchip"><i style="background:#6366f1"></i>Tool definitions</span><span class="lchip"><i style="background:#fbbf24"></i>Conversation</span>
            <span class="sm"><i style="width:5px;height:5px;border-radius:50%;background:#818cf8;display:inline-block"></i>User message</span><span class="sm"><i style="width:14px;border-top:2px dotted #fbbf24;display:inline-block"></i>Pressure level</span></div>
          <div class="chart-wrap" style="position:relative;padding:6px 0 0 0">${svg}<span class="readout"><i>Turn</i> <span class="ro-t">0</span> · <span class="ro-v">42.7K</span><span class="ro-c">0 AIC</span></span>
            <span class="cliff-note" style="left:${cx + 14}px;top:${Y(120000)}px;opacity:0">${ic("rotate")}Compaction · ${fmtInt(D.compaction.before)} → ${fmtInt(D.compaction.after)} tokens</span></div>
        </div>
      </div>
      <div class="met-pane" style="position:absolute;left:0;right:0;top:${14 + 30 + 10 + 38}px;opacity:0">${metrics}</div>
    </div>`;
  win.innerHTML = shell("sessions", main, true);
  const app = win.firstElementChild;
  placeHighlight(app, "sessions");
  placeInk(app, "context");
  app.__geo = { X, Y, L, pw, CW, CH, T, cx, pts: CTX.pts };
  return app;
}
