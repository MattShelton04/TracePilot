import { gsap, ScrollTrigger } from "../lib/gsap.js";
import { Replica } from "../replica/replica.js";
import { $, $$, REDUCE } from "./env.js";
import { Tour } from "./tour.js";

/* =========================================================
   Live demo (variant C, free mode)
   ========================================================= */
// scroll target that puts the demo toolbar just under the nav, so the whole window is in view
export const demoTop = () => $("#demoStage").getBoundingClientRect().top + scrollY - 56 - 14;
// where the tour ends: the "Now take the controls" heading stays in view, with the section
// centred under the nav when it fits and the heading just below the nav when it does not
export const demoIntroTop = () => {
  const head = $("#demo .section-head").getBoundingClientRect(),
    end = $("#demoHost").getBoundingClientRect();
  const room = innerHeight - 56 - (end.bottom - head.top);
  return head.top + scrollY - 56 - Math.max(16, room / 2);
};
export const DEMO_STEPS = [
  ["library", "Library"],
  ["open", "Open a session"],
  ["conversation", "Conversation"],
  ["tree", "Agent tree"],
  ["messages", "Messages"],
  ["context", "Context"],
  ["metrics", "Metrics"],
  ["todos", "Todos"],
  ["search", "Search"],
  ["launch", "Launch"],
];
export const Demo = {
  rp: null,
  current: -1,
  init() {
    const host = $("#demoHost"),
      steps = $("#demoSteps");
    steps.innerHTML = DEMO_STEPS.map(
      (s, i) => `<button type="button" data-i="${i}">${s[1]}</button>`,
    ).join("");
    steps.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) this.play(+b.dataset.i);
    });
    const narrow = innerWidth < 900;
    this.W = narrow ? 560 : innerWidth < 1100 ? 1040 : 1240;
    this.H = narrow ? 860 : 780;
    this.size(); // reserve the space now so nothing below shifts when it builds
    addEventListener("resize", () => this.size());
    const build = () => {
      if (this.rp) return;
      this.rp = new Replica(host, {
        w: this.W,
        h: this.H,
        collapsed: this.W < 1180,
        interactive: true,
        cursor: !REDUCE,
      });
      this.rp.onUser = () => this.setMode("free");
      this.size();
    };
    ScrollTrigger.create({
      trigger: "#demo",
      start: "top bottom+=900",
      once: true,
      onEnter: build,
    });
    this.build = build;
  },
  size() {
    const host = $("#demoHost"),
      wrap = $("#demo .wrap");
    const avail = wrap.clientWidth;
    const narrow = innerWidth < 900;
    const maxH = narrow ? Infinity : innerHeight - 56 - 110;
    const s = Math.min(narrow ? avail / this.W : 1, avail / this.W, maxH / this.H);
    host.style.width = `${Math.round(this.W * s)}px`;
    host.style.height = `${Math.round(this.H * s)}px`;
    if (this.rp) gsap.set(this.rp.root, { scale: s, transformOrigin: "0 0", x: 0, y: 0 });
  },
  setMode(m, label) {
    const el = $("#demoMode"),
      t = $("#demoModeText");
    el.classList.toggle("is-tour", m === "tour");
    $("#demoHost").classList.toggle("is-free", m === "free");
    t.textContent = m === "tour" ? `Showing: ${label}` : "You're driving";
    if (m === "free")
      $$("#demoSteps button").forEach((b) => {
        b.classList.remove("is-on");
      });
  },
  async play(i) {
    this.build();
    const s = DEMO_STEPS[i];
    $$("#demoSteps button").forEach((b, j) => {
      b.classList.toggle("is-on", j === i);
    });
    this.setMode("tour", s[1]);
    const tok = await this.rp.runStep(s[0]);
    void tok;
    if (this.rp.mode === "tour") {
      this.rp.mode = "free";
      $("#demoModeText").textContent = "Your turn: click anything";
      $("#demoMode").classList.remove("is-tour");
    }
  },
  // jump here from elsewhere on the page and play a stop
  go(stepId) {
    Tour.stop();
    const i = Math.max(
      0,
      DEMO_STEPS.findIndex((s) => s[0] === stepId),
    );
    const y = demoTop();
    scrollTo({ top: y, behavior: REDUCE ? "auto" : "smooth" });
    setTimeout(() => this.play(i), REDUCE ? 0 : 750);
  },
};
