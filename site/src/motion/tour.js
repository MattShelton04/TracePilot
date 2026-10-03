import { gsap, ScrollTrigger } from "../lib/gsap.js";
import { anchorY } from "./anchors.js";
import { Demo, demoIntroTop } from "./demo-section.js";
import { $, $$, clamp, REDUCE } from "./env.js";
import { holds } from "./holds.js";

/* =========================================================
   Guided tour: hands-free auto scroll down to the live demo.
   Starts from wherever the page is; the bar shows progress through the whole page,
   with a tick per chapter. Previous/next jump between chapters; speed cycles.
   Pinned scenes play as the page scrolls; a timed animation (a phone frame, see holds.js)
   is centred and waited for.
   ========================================================= */
export const Tour = (() => {
  let on = false,
    raf = 0,
    y = 0,
    last = 0,
    endY = 0,
    rate = 1,
    starts = [],
    shown = -1,
    since = 0; // when the chapter on screen began showing
  const pill = $("#tourPill"),
    label = $("#tourLabel"),
    prog = $("#tourProg"),
    ticks = $("#tourTicks"),
    speedBtn = $("#tourSpeed");
  const CHAPTERS = [
    ["#open", "Open any session"],
    ["#conversation", "Three agents, one turn"],
    ["#agents", "Watch the agents talk"],
    ["#context", "Context and cost"],
    ["#launch", "Launch the next one"],
    ["#more", "Zoom out"],
    ["#demo", "Your turn"],
  ];
  const RATES = [1, 1.5, 2, 0.5];
  const LEEWAY = 3000; // ms into a chapter before "previous" restarts it instead of going back
  const EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];
  const speed = () => Math.max(300, innerHeight * 0.5) * rate; // px per second
  // any scroll or input stops the tour, except pressing the tour's own controls
  const halt = (e) => {
    if (e.type !== "wheel" && e.target?.closest?.("#tourPill")) return;
    stop();
  };

  // chapter start positions; the tour ends on the demo section, its heading in view
  function measure() {
    endY = demoIntroTop();
    starts = CHAPTERS.map(([sel], i) =>
      i === 0 ? 0 : i === CHAPTERS.length - 1 ? endY : anchorY($(sel), { label: false }),
    );
    ticks.innerHTML = starts
      .slice(1, -1)
      .map((s) => `<i style="left:${((s / endY) * 100).toFixed(2)}%"></i>`)
      .join("");
  }
  // the chapter on screen: its section has reached the middle of the viewport
  const chapter = () => {
    let i = 0;
    starts.forEach((s, k) => {
      if (y >= s - innerHeight * 0.5) i = k;
    });
    return i;
  };
  function paint() {
    prog.style.transform = `scaleX(${clamp(y / Math.max(1, endY), 0, 1).toFixed(4)})`;
    const i = chapter();
    if (i === shown) return;
    shown = i;
    since = performance.now();
    label.textContent = CHAPTERS[i][1];
  }

  function start() {
    if (on || REDUCE) return;
    measure();
    if (scrollY >= endY - 40) scrollTo(0, 0);
    on = true;
    y = scrollY;
    last = 0;
    shown = -1;
    paint();
    pill.hidden = false;
    gsap.fromTo(pill, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: "expo.out" });
    EVENTS.forEach((t) => {
      addEventListener(t, halt, { passive: true });
    });
    raf = requestAnimationFrame(step);
  }
  function step(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    const held = [...holds][0];
    // scroll on to centre a timed animation under the nav, then wait for it to finish
    const cap = held
      ? held.getBoundingClientRect().top + scrollY - (innerHeight + 56 - held.offsetHeight) / 2
      : endY;
    if (y < cap) y = Math.min(cap, endY, y + speed() * dt);
    scrollTo(0, y);
    paint();
    if (y >= endY - 0.5) {
      stop();
      arrived();
      return;
    }
    raf = requestAnimationFrame(step);
  }
  function stop() {
    if (!on) return;
    on = false;
    cancelAnimationFrame(raf);
    EVENTS.forEach((t) => {
      removeEventListener(t, halt);
    });
    gsap.to(pill, { opacity: 0, y: 16, duration: 0.25, onComplete: () => (pill.hidden = true) });
  }
  function arrived() {
    Demo.build();
    $("#demoModeText").textContent = "Your turn: click anything";
    gsap.fromTo(
      "#demoMode",
      { scale: 1 },
      { scale: 1.08, duration: 0.2, yoyo: true, repeat: 3, ease: "power1.inOut" },
    );
  }
  // jump to a chapter and keep touring from there; the scrubbed scene catches up on its own
  function skip(dir) {
    if (!on) return;
    const i = chapter();
    // like a media player: "previous" restarts the current chapter, unless it only just began
    const k = dir > 0 ? i + 1 : performance.now() - since > LEEWAY ? i : i - 1;
    y = Math.min(endY, starts[clamp(k, 0, starts.length - 1)]);
    scrollTo(0, y);
    last = 0;
    shown = -1;
    paint();
  }
  function cycleSpeed() {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    speedBtn.textContent = `${rate}×`;
    speedBtn.setAttribute("aria-label", `Tour speed ${rate}×. Change speed`);
  }

  $("#tourStop").addEventListener("click", stop);
  $("#tourPrev").addEventListener("click", () => skip(-1));
  $("#tourNext").addEventListener("click", () => skip(1));
  speedBtn.addEventListener("click", cycleSpeed);
  ScrollTrigger.addEventListener("refresh", () => {
    if (on) measure();
  });
  $$("[data-tour]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      start();
    });
  });
  return {
    start,
    stop,
    get on() {
      return on;
    },
  };
})();
