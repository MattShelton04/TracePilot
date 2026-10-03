import { buildAgents } from "../app-views/agents.js";
import { buildContext } from "../app-views/context.js";
import { buildConvo } from "../app-views/convo.js";
import { buildLaunch } from "../app-views/launch.js";
import { buildOpen } from "../app-views/open.js";
import { $, $$, DESK, html, PIN } from "./env.js";

/* ---------- build the desktop windows (variant A) ---------- */
export const apps = DESK
  ? {
      open: buildOpen($("#winOpen")),
      convo: buildConvo($("#winConvo")),
      agents: buildAgents($("#winAgents")),
      context: buildContext($("#winContext")),
      launch: buildLaunch($("#winLaunch")),
    }
  : null;

export function fit() {
  if (!DESK) return;
  $$(".stage").forEach((stage) => {
    const win = $(".win", stage);
    const cs = getComputedStyle(stage);
    const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let s;
    if (PIN) {
      const h = stage.clientHeight - Math.max(20, innerHeight * 0.03);
      s = Math.min(Math.min(w, 1760) / 1280, h / 800);
    } else {
      s = Math.min(w, 1120) / 1280;
    }
    win.style.setProperty("--s", Math.max(0.2, s).toFixed(4));
    win.__s = Math.max(0.2, s);
  });
  // scene headings line up with the window edges when the window is wider than the text column
  if (PIN) html.style.setProperty("--win-w", `${Math.round(1280 * $("#winConvo").__s)}px`);
}
fit();

export function setHeroDY() {
  const heroCopy = $("#heroCopy"),
    win = $("#winOpen");
  if (!PIN) return;
  const hb = heroCopy.offsetTop + heroCopy.offsetHeight + 44;
  win.style.setProperty("--heroDY", `${Math.max(0, hb - win.parentElement.offsetTop)}px`);
}
