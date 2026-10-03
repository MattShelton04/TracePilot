import { gsap } from "../lib/gsap.js";
import { RM } from "./shared.js";

export const transitionMethods = {
  /* ---------- the signature transition: card -> session ---------- */
  async openSession(card, tok, gotoTab) {
    const lib = this.views.sessions;
    const det = this.getView("session");
    const S = this.scale();
    const vr = this.el.views.getBoundingClientRect();
    const L = (r) => ({
      left: (r.left - vr.left) / S,
      top: (r.top - vr.top) / S,
      width: r.width / S,
      height: r.height / S,
    });
    const cTitle = card.querySelector(".scard-title");
    const cChips = card.querySelector(".rp-chips");
    const r0 = L(card.getBoundingClientRect());
    const rt = cTitle.getBoundingClientRect();
    const rc = cChips.getBoundingClientRect();
    const fsCard = parseFloat(getComputedStyle(cTitle).fontSize);

    this.view = "session";
    this.tab = gotoTab || "overview";
    this.setActiveNav("session");
    this.renderCrumbs();
    det.hidden = false;
    det.scrollTop = 0;
    gsap.set(det, { opacity: 1, y: 0 });
    this.startClock();
    this.setTab(this.tab, { anim: false, intro: false, force: true });

    if (RM) {
      lib.hidden = true;
      this.introPanel(this.tab);
      if (this.onState) this.onState();
      return true;
    }
    const title = det.querySelector(".sd-title");
    const chipsEl = det.querySelector(".sd-head .rp-chips");
    const tr = title.getBoundingClientRect();
    const tc = chipsEl.getBoundingClientRect();
    const fsHead = parseFloat(getComputedStyle(title).fontSize);
    const rest = [
      det.querySelector(".sd-actions"),
      det.querySelector(".sd-tabs-wrap"),
      det.querySelector(".sd-panels"),
    ];
    const others = Array.from(lib.querySelectorAll(".scard")).filter((c) => c !== card);
    const ex = document.createElement("div");
    ex.className = "sd-expander";
    this.el.views.appendChild(ex);
    const full = {
      left: 14,
      top: 8,
      width: this.el.views.clientWidth - 28,
      height: this.el.views.clientHeight - 16,
    };

    gsap.set(card, { opacity: 0 });
    gsap.set(rest, { opacity: 0, y: 16 });
    const tl = gsap.timeline();
    tl.fromTo(
      ex,
      Object.assign({ opacity: 1 }, r0),
      Object.assign({ duration: 0.62, ease: "expo.inOut" }, full),
      0,
    )
      .to(ex, { opacity: 0, duration: 0.32, ease: "power1.out" }, 0.42)
      .to(
        others,
        { opacity: 0, scale: 0.94, y: 10, duration: 0.34, ease: "power2.in", stagger: 0.012 },
        0,
      )
      .to(
        lib.querySelector(".lib-toolbar"),
        { opacity: 0, y: -6, duration: 0.24, ease: "power2.in" },
        0,
      )
      .from(
        title,
        {
          x: (rt.left - tr.left) / S,
          y: (rt.top - tr.top) / S,
          scale: fsCard / fsHead,
          duration: 0.66,
          ease: "expo.inOut",
        },
        0,
      )
      .from(
        chipsEl,
        {
          x: (rc.left - tc.left) / S,
          y: (rc.top - tc.top) / S,
          duration: 0.66,
          ease: "expo.inOut",
        },
        0.02,
      )
      .to(
        rest,
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: "expo.out",
          stagger: 0.07,
          clearProps: "transform,opacity",
        },
        0.36,
      )
      .add(() => {
        ex.remove();
        lib.hidden = true;
        gsap.set([card, others, lib.querySelector(".lib-toolbar")], { clearProps: "all" });
      });
    this.track(tl);
    this.track(gsap.delayedCall(0.5, () => this.introPanel(this.tab)));
    if (this.onState) this.onState();
    const ok = await this.done(tl, tok);
    if (!ok && ex.parentNode) ex.remove();
    return ok;
  },

  /* ---------- tabs ---------- */
  placeInk(anim) {
    const det = this.views.session;
    if (!det || det.hidden) return;
    const t = det.querySelector(`.sd-tab[data-tab="${this.tab}"]`);
    const ink = det.querySelector(".sd-ink");
    if (!t || !ink) return;
    const v = { x: t.offsetLeft, scaleX: t.offsetWidth / 100 };
    if (anim && !RM)
      this.track(gsap.to(ink, Object.assign({ duration: 0.46, ease: "expo.out" }, v)));
    else gsap.set(ink, v);
    const bar = t.parentElement;
    if (bar.scrollWidth > bar.clientWidth) {
      const target = Math.max(0, t.offsetLeft - 24);
      if (anim && !RM)
        this.track(gsap.to(bar, { scrollLeft: target, duration: 0.4, ease: "power2.out" }));
      else bar.scrollLeft = target;
    }
  },
  setTab(name, opts) {
    opts = opts || {};
    const det = this.getView("session");
    if (this.view !== "session") return this.showView("session", { tab: name });
    const prevName = this.tab;
    this.tab = name;
    det.querySelectorAll(".sd-tab").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    this.placeInk(opts.anim !== false);
    const panels = det.querySelectorAll(".sd-panel");
    const next = det.querySelector(`.sd-panel[data-panel="${name}"]`);
    if (prevName !== name || opts.force) {
      panels.forEach((p) => {
        if (p !== next) p.hidden = true;
      });
      next.hidden = false;
      if (opts.anim !== false && !RM)
        this.track(
          gsap.fromTo(
            next,
            { opacity: 0, y: 8 },
            { opacity: 1, y: 0, duration: 0.42, ease: "expo.out", clearProps: "transform,opacity" },
          ),
        );
    }
    if (name === "timeline") this.setTlMode(this.tlMode, { anim: false, intro: false });
    this.renderCrumbs();
    if (opts.intro !== false) this.introPanel(name);
    if (this.onState) this.onState();
  },
  setTlMode(mode, opts) {
    opts = opts || {};
    const det = this.getView("session");
    this.tlMode = mode;
    det.querySelectorAll("[data-tl]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.tl === mode);
    });
    det.querySelectorAll(".tm-mode").forEach((m) => {
      const on = m.dataset.mode === mode;
      if (on && m.hidden && opts.anim !== false && !RM)
        this.track(
          gsap.fromTo(
            m,
            { opacity: 0, y: 8 },
            { opacity: 1, y: 0, duration: 0.4, ease: "expo.out", clearProps: "transform,opacity" },
          ),
        );
      m.hidden = !on;
    });
    if (opts.intro !== false) this.introTimeline(mode);
  },

  /* ---------- cache countdown ---------- */
  startClock() {
    if (this.clockOn) return;
    this.clockOn = true;
    const tick = () => {
      const chips = this.root.querySelectorAll(".cache-chip");
      chips.forEach((c) => {
        const t = c.querySelector(".cc-t");
        if (this.cacheLeft > 0) {
          const m = Math.floor(this.cacheLeft / 60),
            s = this.cacheLeft % 60;
          t.textContent = `Cache expiring · ${m}:${String(s).padStart(2, "0")}`;
        } else {
          c.classList.add("is-cold");
          t.textContent = "Cache expired";
        }
      });
    };
    tick();
    this.clockId = setInterval(() => {
      if (this.cacheLeft > 0) this.cacheLeft--;
      tick();
    }, 1000);
  },
};
