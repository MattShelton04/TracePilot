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
import { field, initHero, intro } from "./hero.js";
import { sceneAgents } from "./scene-agents.js";
import { sceneContext } from "./scene-context.js";
import { sceneConvo } from "./scene-convo.js";
import { sceneLaunch } from "./scene-launch.js";
import { sceneOpen } from "./scene-open.js";
import { apps, fit, setHeroDY } from "./stage.js";

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
export function wire() {
  const scenes = [
    { el: $("#open"), build: sceneOpen, len: 3.2 },
    { el: $("#conversation"), build: sceneConvo, len: 3.4 },
    { el: $("#agents"), build: sceneAgents, len: 3.2 },
    { el: $("#context"), build: sceneContext, len: 3.4 },
    { el: $("#launch"), build: sceneLaunch, len: 3.2 },
  ];
  if (DESK) {
    placeInk($(".dv", apps.open), "overview");
    placeInk(apps.context, "context");
    placeSeg(apps.agents);
  }
  html.classList.add("ready");
  rail.init($("#rail"), $("#start"));
  layoutRail();
  initHero();

  if (DESK) {
    scenes.forEach((s) => {
      const tl = s.build();
      if (REDUCE) {
        tl.progress(1).pause();
        return;
      }
      if (PIN) {
        tl.pause();
        const lead = s.el.id === "open" ? 0 : 0.6;
        const pinOpts = {
          trigger: s.el,
          start: "top top",
          end: () => `+=${innerHeight * s.len}`,
          pin: true,
          anticipatePin: 1,
          onToggle: (st) => s.el.classList.toggle("is-active", st.isActive),
        };
        if (!lead) ScrollTrigger.create({ ...pinOpts, animation: tl, scrub: 0.6 });
        else {
          ScrollTrigger.create({
            trigger: s.el,
            start: `top ${lead * 100}%`,
            end: () => `+=${innerHeight * (s.len + lead)}`,
            animation: tl,
            scrub: 0.6,
          });
          ScrollTrigger.create(pinOpts);
        }
      }
    });
    layoutBranches();
  } else {
    initFrames();
  }
  if (REDUCE) {
    cache.start();
    rail.setReveal(1);
  }
  if (!REDUCE) intro();

  initBento($("#bento"), { parallax: !REDUCE });
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
