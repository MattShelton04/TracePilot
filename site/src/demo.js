// Full-screen live demo entry (demo/index.html).
import "./styles/demo.css";
import { gsap } from "./lib/gsap.js";
import { Replica } from "./replica/replica.js";

const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const STEPS = [
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
const stage = document.getElementById("stage");
const host = document.getElementById("host");
const steps = document.getElementById("steps");
let rp = null;
let W = 0;
let H = 0;

function layout() {
  const sw = stage.clientWidth - 24;
  const sh = stage.clientHeight - 24;
  const narrow = sw < 760;
  const nW = narrow ? 560 : Math.max(1040, Math.min(1440, Math.round(sw / Math.min(1, sw / 1240))));
  const s0 = narrow ? sw / nW : Math.min(1, sw / nW, sh / 700);
  const nH = Math.round(Math.max(narrow ? 780 : 640, sh / s0));
  if (!rp) {
    W = nW;
    H = nH;
    rp = new Replica(host, { w: W, h: H, collapsed: W < 1180, interactive: true, cursor: !RM });
  } else if (nW !== W || nH !== H) {
    W = nW;
    H = nH;
    rp.setSize(W, H);
    rp.root.classList.toggle("is-collapsed", W < 1180);
  }
  const s = Math.min(sw / W, sh / H);
  host.style.width = `${Math.round(W * s)}px`;
  host.style.height = `${Math.round(H * s)}px`;
  gsap.set(rp.root, { scale: s, transformOrigin: "0 0" });
}

steps.innerHTML = STEPS.map((s, i) => `<button type="button" data-i="${i}">${s[1]}</button>`).join(
  "",
);
steps.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  steps.querySelectorAll("button").forEach((x) => {
    x.classList.toggle("is-on", x === b);
  });
  rp.runStep(STEPS[+b.dataset.i][0]);
});

document.fonts.ready.then(() => {
  layout();
  rp.onUser = () =>
    steps.querySelectorAll("button").forEach((x) => {
      x.classList.remove("is-on");
    });
  const want = (location.hash || "").slice(1);
  const i = STEPS.findIndex((s) => s[0] === want);
  if (i >= 0) steps.querySelectorAll("button")[i].click();
  let t = 0;
  addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(layout, 120);
  });
});
