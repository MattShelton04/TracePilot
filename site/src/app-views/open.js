import { D } from "../data.js";
import { overviewHTML } from "../lib/overview.js";
import {
  chipsFor,
  crumbs,
  cursorHTML,
  esc,
  libraryContent,
  placeInk,
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
      <div class="dv-ov">${overviewHTML()}</div>
    </div>${cursorHTML}`;
  win.innerHTML = shell("sessions", main);
  const app = win.firstElementChild;
  placeInk(app.querySelector(".dv"), "overview");
  return app;
}
