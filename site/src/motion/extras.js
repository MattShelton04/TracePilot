import { gsap, ScrollTrigger } from "../lib/gsap.js";
import { anchorY } from "./anchors.js";
import { $, $$, DESK, REDUCE } from "./env.js";

export function initPrivacy() {
  if (REDUCE) return;
  const fig = $("#pipeline");
  if (!fig) return;
  const nodes = $$(".pipe-node", fig),
    links = $$(".pipe-link i", fig),
    box = $(".pipe-boundary", fig),
    out = $(".pipe-outside", fig);
  const vertical = !DESK;
  gsap.set(nodes, { opacity: 0, y: 14 });
  gsap.set([box, out], { opacity: 0 });
  ScrollTrigger.create({
    trigger: fig,
    start: "top 75%",
    once: true,
    onEnter: () => {
      const t = gsap.timeline();
      t.to(box, { opacity: 1, duration: 0.6 });
      t.to(nodes, { opacity: 1, y: 0, duration: 0.6, stagger: 0.12, ease: "expo.out" }, 0.1);
      links.forEach((l, i) => {
        t.fromTo(
          l,
          vertical ? { yPercent: -110 } : { xPercent: -110 },
          {
            ...(vertical ? { yPercent: 110 } : { xPercent: 110 }),
            duration: 0.55,
            ease: "power1.inOut",
          },
          0.8 + i * 0.5,
        );
        t.fromTo(
          nodes[i + 1],
          { borderColor: "rgba(255,255,255,.1)" },
          { borderColor: "rgba(129,140,248,.7)", duration: 0.2, yoyo: true, repeat: 1 },
          1.2 + i * 0.5,
        );
      });
      t.to(out, { opacity: 1, duration: 0.5 }, 2.6);
    },
  });
  $$(".section-head").forEach((el) => {
    gsap.from(el.querySelectorAll(".eyebrow, h2, .lede"), {
      opacity: 0,
      y: 22,
      duration: 0.9,
      ease: "expo.out",
      stagger: 0.07,
      scrollTrigger: { trigger: el, start: "top 82%", once: true },
    });
  });
}

export function initNav() {
  const nav = $("#nav"),
    bar = $("#navProgress");
  const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 40);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate: (st) => gsap.set(bar, { scaleX: st.progress }),
  });
  $$(".nav-links a[href^='#']").forEach((a) => {
    const sec = $(a.getAttribute("href"));
    if (!sec) return;
    ScrollTrigger.create({
      trigger: sec,
      start: "top 50%",
      end: "bottom 50%",
      onToggle: (st) => a.classList.toggle("is-current", st.isActive),
    });
  });
  // in-page links to pinned scenes: jump to the pin start (see anchorY), not the scene's live position
  const pinned = (hash) => {
    const el = hash.length > 1 && document.getElementById(hash.slice(1));
    return el && ScrollTrigger.getAll().some((t) => t.pin === el) ? el : null;
  };
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const el = pinned(a.getAttribute("href"));
    if (!el) return;
    e.preventDefault();
    history.pushState(null, "", a.getAttribute("href"));
    scrollTo(0, anchorY(el));
  });
  // a deep link was resolved before the pins added their scroll length; resolve it again
  if (location.hash.length > 1) {
    const el = document.getElementById(location.hash.slice(1));
    if (el) scrollTo(0, anchorY(el));
  }
}

export function initEye() {
  const eye = $("#finalEye");
  if (!eye || REDUCE || !matchMedia("(pointer: fine)").matches) return;
  const pupil = $(".pupil-g", eye);
  const qx = gsap.quickTo(pupil, "x", { duration: 0.5, ease: "power3.out" }),
    qy = gsap.quickTo(pupil, "y", { duration: 0.5, ease: "power3.out" });
  addEventListener(
    "pointermove",
    (e) => {
      const r = eye.getBoundingClientRect();
      if (r.bottom < -200 || r.top > innerHeight + 200) return;
      const dx = e.clientX - (r.left + r.width / 2),
        dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1,
        k = Math.min(1, d / 400) * 4;
      qx((dx / d) * k * 1.2);
      qy((dy / d) * k * 0.8);
    },
    { passive: true },
  );
}
