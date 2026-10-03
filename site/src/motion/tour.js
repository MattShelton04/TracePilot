import { gsap } from "../lib/gsap.js";
import { Demo, demoTop } from "./demo-section.js";
import { $, $$, clamp, REDUCE } from "./env.js";

/* =========================================================
   Guided tour: hands-free auto scroll down to the live demo
   ========================================================= */
export const Tour = (() => {
  let on = false,
    raf = 0,
    y = 0,
    last = 0,
    endY = 0,
    startY = 0;
  const pill = $("#tourPill"),
    label = $("#tourLabel"),
    prog = $("#tourProg");
  const LABELS = [
    ["#open", "Open any session"],
    ["#conversation", "Three agents, one turn"],
    ["#agents", "Watch the agents talk"],
    ["#context", "Context and cost"],
    ["#launch", "Launch the next one"],
    ["#more", "Zoom out"],
    ["#demo", "Your turn"],
  ];
  const speed = () => Math.max(300, innerHeight * 0.5); // px per second
  const halt = (e) => {
    if (e?.target?.closest?.("#tourPill")) return;
    stop();
  };
  function start() {
    if (on || REDUCE) return;
    endY = demoTop();
    if (scrollY >= endY - 40) scrollTo(0, 0);
    on = true;
    y = startY = scrollY;
    last = 0;
    pill.hidden = false;
    gsap.fromTo(pill, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: "expo.out" });
    ["wheel", "touchstart", "keydown", "pointerdown"].forEach((t) => {
      addEventListener(t, halt, { passive: true });
    });
    raf = requestAnimationFrame(step);
  }
  function step(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    y = Math.min(endY, y + speed() * dt);
    scrollTo(0, y);
    prog.style.transform = `scaleX(${clamp((y - startY) / Math.max(1, endY - startY), 0, 1).toFixed(4)})`;
    let cur = LABELS[0][1];
    LABELS.forEach(([sel, txt]) => {
      const el = $(sel);
      if (el && el.getBoundingClientRect().top <= innerHeight * 0.5) cur = txt;
    });
    if (label.textContent !== cur) label.textContent = cur;
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
    ["wheel", "touchstart", "keydown", "pointerdown"].forEach((t) => {
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
  $("#tourStop").addEventListener("click", stop);
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
