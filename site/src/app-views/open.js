import { D } from "../data.js";
import { fmtAic, fmtInt } from "../lib/format.js";
import { ic } from "./icons.js";
import {
  chipsFor,
  clock,
  crumbs,
  cursorHTML,
  dur,
  esc,
  libraryContent,
  placeHighlight,
  placeInk,
  planHTML,
  shell,
  tabsHTML,
  toolbar,
} from "./shell.js";

/* ---------- 1. Open window ---------- */
export function buildOpen(win) {
  const H = D.heroDetail;
  const main = `
    <div class="crumb"><span class="crumb-lib" style="display:contents"><b>Sessions</b></span>
      <span class="crumb-alt crumb-detail" style="opacity:0">${crumbs("Sessions", esc(D.heroDetail.summary), "Overview")}</span></div>
    <div class="content lib">${libraryContent(D.sessions.slice(0, 12), D.sessionCount)}</div>
    <div class="content dv" style="pointer-events:none">
      <h1 class="dv-title"><span class="t">${esc(H.summary)}</span></h1>
      <div class="dv-chips">${chipsFor(H)}</div>
      ${toolbar()}
      ${tabsHTML("overview")}
      <div class="tiles t4">
        <div class="stile panel"><span class="v v-indigo" data-fly="events">${H.eventCount}</span><span class="l">Events</span></div>
        <div class="stile panel"><span class="v v-indigo" data-fly="turns">${H.turnCount}</span><span class="l">Turns</span></div>
        <div class="stile panel"><span class="v v-green">${H.checkpointCount}</span><span class="l">Checkpoints</span></div>
        <div class="stile panel"><span class="v v-violet">${fmtAic(D.costs.hero.aic)}</span><span class="l">AI Credits</span></div>
      </div>
      <div class="dv-panels">
        <div class="panel"><div class="panel-h">Session info</div><dl class="kv">
          <dt>Session ID</dt><dd class="mono" style="font-size:11.5px">${H.id}</dd><dt>Repository</dt><dd>${H.repository}</dd>
          <dt>Branch</dt><dd>${H.branch}</dd><dt>Model</dt><dd>${H.currentModel}</dd><dt>Duration</dt><dd>${dur(D.heroMetrics.totalApiDurationMs)}</dd></dl></div>
        <div class="panel"><div class="panel-h">Session summary</div><dl class="kv" style="grid-template-columns:110px 1fr">
          <dt>API Duration</dt><dd>${dur(D.heroMetrics.totalApiDurationMs)}</dd><dt>Current Model</dt><dd><span class="chip c-model">${H.currentModel}</span></dd>
          <dt>Shutdown Type</dt><dd>${H.shutdownMetrics.shutdownType}</dd>
          <dt>Code Changes</dt><dd><span class="plus">+${H.shutdownMetrics.codeChanges.linesAdded}</span> / <span class="minus">−${H.shutdownMetrics.codeChanges.linesRemoved}</span></dd>
          <dt>Compactions</dt><dd>${D.compaction.count} · ${fmtInt(D.compaction.before)} → ${fmtInt(D.compaction.after)} tokens</dd></dl></div>
      </div>
      <div class="dv-more">
        <div class="panel inc"><div class="inc-h"><b>Incidents</b><span class="inc-n">${D.heroIncidents.length}</span></div>
          <div class="inc-r"><span class="inc-b">Compaction</span><span>${esc(D.heroIncidents[0].summary)}</span><span class="inc-d">${ic("chevR")}Detail</span><time>${clock(D.heroIncidents[0].timestamp)}</time></div></div>
        <div class="panel plan"><div class="panel-h">Session plan<span class="plan-hide">Hide</span></div>
          <div class="plan-b">${planHTML(D.heroPlan.content)}</div></div>
      </div>
    </div>${cursorHTML}`;
  win.innerHTML = shell("sessions", main);
  const app = win.firstElementChild;
  placeHighlight(app, "sessions");
  placeInk(app.querySelector(".dv"), "overview");
  return app;
}
