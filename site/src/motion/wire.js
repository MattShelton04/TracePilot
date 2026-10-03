import { placeSeg } from "../app-views/agents.js";
import { placeInk } from "../app-views/shell.js";
import { initBento } from "../bento/index.js";
import { ScrollTrigger } from "../lib/gsap.js";
import { finalTraces } from "../traces/final.js";
import { rail } from "../traces/rail.js";
import { layoutBranches } from "./branches.js";
import { cache } from "./cache.js";
import { Demo } from "./demo-section.js";
import { $, DESK, html, PIN, REDUCE } from "./env.js";
import { initEye, initNav, initPrivacy } from "./extras.js";
import { initFrames } from "./frames.js";
import { field, initHero } from "./hero.js";
import { sceneAgents } from "./scene-agents.js";
import { sceneContext } from "./scene-context.js";
import { sceneConvo } from "./scene-convo.js";
import { sceneLaunch } from "./scene-launch.js";
import { sceneOpen } from "./scene-open.js";
import { buildApp, fit, setHeroDY } from "./stage.js";

/* =========================================================
   Wiring
   ========================================================= */
export function layoutRail() {
  if (!PIN) {
    rail.layout(-1);
    return;
  }
  const left = Math.min(
    $("#conversation .scene-copy").getBoundingClientRect().left,
    $("#winConvo").getBoundingClientRect().left,
  );
  rail.layout(left);
}
export let finals = null;

const SCENES = [
  {
    id: "open",
    build: sceneOpen,
    len: 3.2,
    prep: (app) => placeInk($(".dv", app), "overview"),
  },
  { id: "conversation", app: "convo", build: sceneConvo, len: 3.4 },
  { id: "agents", build: sceneAgents, len: 3.2, prep: placeSeg },
  { id: "context", build: sceneContext, len: 3.4, prep: (app) => placeInk(app, "context") },
  { id: "launch", build: sceneLaunch, len: 3.2 },
];

// Scroll-scrub a scene's timeline and pin the scene for its length. The static .scene-spacer
// around each scene is passed as the pin spacer, so pinning and refreshes never re-insert the
// scene into the document (re-insertion restarts the CSS hero entrance inside #open).
function pinScene(el, tl, len) {
  const lead = el.id === "open" ? 0 : 0.6;
  const pinOpts = {
    trigger: el,
    start: "top top",
    end: () => `+=${innerHeight * len}`,
    pin: true,
    pinSpacer: el.parentElement,
    anticipatePin: 1,
    onToggle: (st) => el.classList.toggle("is-active", st.isActive),
  };
  if (!lead) ScrollTrigger.create({ ...pinOpts, animation: tl, scrub: 0.6 });
  else {
    ScrollTrigger.create({
      trigger: el,
      start: `top ${lead * 100}%`,
      end: () => `+=${innerHeight * (len + lead)}`,
      animation: tl,
      scrub: 0.6,
    });
    ScrollTrigger.create(pinOpts);
  }
}

// a fresh task: the build yields between steps so no single task blocks input or rendering
const nextTask = () => new Promise((resolve) => setTimeout(resolve));

export async function wire() {
  fit();
  rail.init($("#rail"), $("#start"));
  layoutRail();
  initHero();

  if (DESK) {
    // one window and its timeline per task; .ready lets the first window rise in (CSS)
    const tls = [];
    for (const s of SCENES) {
      const app = buildApp(s.app || s.id);
      s.prep?.(app);
      const tl = s.build();
      if (REDUCE) tl.progress(1).pause();
      else tl.pause();
      tls.push(tl);
      html.classList.add("ready");
      await nextTask();
    }
    // pins go in together: each pin queues a refresh of every trigger
    if (PIN) {
      SCENES.forEach((s, i) => {
        pinScene($(`#${s.id}`), tls[i], s.len);
      });
    }
    layoutBranches();
  } else {
    html.classList.add("ready");
    initFrames();
  }
  if (REDUCE) {
    cache.start();
    rail.setReveal(1);
  }
  await nextTask();

  initBento($("#bento"), { parallax: !REDUCE });
  await nextTask();

  Demo.init();
  initPrivacy();
  initNav();
  initEye();
  finals = finalTraces($("#finalTraces"), $("#start"), $("#finalEye"));
  finals.layout();
  const onScroll = () => {
    rail.update();
    finals.update();
  };
  addEventListener("scroll", onScroll, { passive: true });
  ScrollTrigger.addEventListener("refresh", () => {
    finals.layout();
    onScroll();
  });
  onScroll();

  let rt = 0,
    lastW = innerWidth;
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      // phones fire resize when the URL bar collapses; only relayout on width changes there
      if (!DESK && innerWidth === lastW) return;
      lastW = innerWidth;
      fit();
      setHeroDY();
      layoutRail();
      field?.layout();
      ScrollTrigger.refresh();
      layoutBranches();
    }, 150);
  });
}
