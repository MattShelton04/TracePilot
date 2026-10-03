import { gsap } from "../lib/gsap.js";
import { AGI, fmtDur, fmtTok, RM, TODO_COUNTS } from "./shared.js";

export const introMethods = {
  /* ---------- intros ---------- */
  countUps(scope, dur) {
    scope.querySelectorAll("[data-count]").forEach((el) => {
      const to = parseFloat(el.dataset.count);
      const dec = +(el.dataset.dec || 0);
      const fmt = el.dataset.fmt;
      const pre = el.dataset.prefix || "",
        suf = el.dataset.suffix || "";
      const render = (v) => {
        let s;
        if (fmt === "tok") s = fmtTok(v);
        else if (fmt === "dur") s = fmtDur(v * 1000);
        else if (fmt === "int") s = Math.round(v).toLocaleString("en-US");
        else if (fmt === "money")
          s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        else s = dec ? v.toFixed(dec) : String(Math.round(v));
        el.textContent = pre + s + suf;
      };
      const o = { v: 0 };
      render(0);
      this.track(
        gsap.to(o, {
          v: to,
          duration: dur || 0.9,
          ease: "power3.out",
          onUpdate: () => render(o.v),
        }),
      );
    });
  },
  introView(name, opts) {
    const v = this.views[name];
    if (!v || RM) return;
    if (name === "sessions") {
      this.track(
        gsap.fromTo(
          v.querySelectorAll(".scard"),
          { opacity: 0, y: 14 },
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            ease: "expo.out",
            stagger: 0.035,
            delay: 0.08,
            clearProps: "transform,opacity",
          },
        ),
      );
    } else if (name === "search") {
      if (!opts || !opts.demo) this.searchFinal(true);
    } else if (name === "launcher") {
      if (!opts || !opts.demo) this.launcherFinal();
    } else if (name !== "session" && name !== "lite") {
      this.countUps(v, 1);
      this.track(
        gsap.fromTo(
          v.querySelectorAll(".rp-panel, .mini-card, .an-charts > *"),
          { opacity: 0, y: 12 },
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            ease: "expo.out",
            stagger: 0.04,
            delay: 0.12,
            clearProps: "transform,opacity",
          },
        ),
      );
      v.querySelectorAll(".an-line").forEach((p) => {
        const L = p.getTotalLength();
        this.track(
          gsap.fromTo(
            p,
            { strokeDasharray: L, strokeDashoffset: L },
            { strokeDashoffset: 0, duration: 1.4, ease: "power2.inOut", delay: 0.2 },
          ),
        );
      });
      const bars = v.querySelectorAll(".an-bar");
      if (bars.length)
        this.track(
          gsap.from(bars, {
            scaleY: 0,
            transformOrigin: "50% 100%",
            duration: 0.6,
            ease: "expo.out",
            stagger: 0.008,
            delay: 0.25,
          }),
        );
      const hb = v.querySelectorAll(".hb .bar span, .tbl .sbar span, .mini-card .mt-track span");
      if (hb.length)
        this.track(
          gsap.from(hb, { scaleX: 0, duration: 0.8, ease: "expo.out", stagger: 0.04, delay: 0.2 }),
        );
    }
  },
  introPanel(name) {
    const det = this.views.session;
    if (!det) return;
    const p = det.querySelector(`.sd-panel[data-panel="${name}"]`);
    if (!p) return;
    if (name === "overview") {
      this.countUps(p, 0.9);
      if (!RM)
        this.track(
          gsap.fromTo(
            p.querySelectorAll(".rp-panel, .ov-incident"),
            { opacity: 0, y: 12 },
            {
              opacity: 1,
              y: 0,
              duration: 0.6,
              ease: "expo.out",
              stagger: 0.06,
              delay: 0.1,
              clearProps: "transform,opacity",
            },
          ),
        );
    } else if (name === "conversation") this.introConversation(p);
    else if (name === "todos") this.introTodos(p);
    else if (name === "metrics") this.introMetrics(p);
    else if (name === "context") this.introContext(p);
    else if (name === "timeline") this.introTimeline(this.tlMode);
    else if (name === "events" && !RM)
      this.track(
        gsap.from(p.querySelectorAll("tbody tr"), {
          opacity: 0,
          x: -8,
          duration: 0.4,
          ease: "expo.out",
          stagger: 0.025,
        }),
      );
  },

  introConversation(p) {
    const cards = Array.from(p.querySelectorAll(".sa"));
    const launch = p.querySelector(".cv-launch");
    const rows = Array.from(p.querySelectorAll(".tl-row"));
    const pills = Array.from(p.querySelectorAll(".cv-pill"));
    const m2 = p.querySelector(".cv-m2");
    const intent = p.querySelector(".cv-intent");
    const SIM = 2.6 / 320; // seconds of animation per simulated second
    const T0 = 1.0;
    const tl = gsap.timeline();
    tl.set(cards, { opacity: 0 })
      .set(rows, { opacity: 0, x: -10 })
      .set(pills, { opacity: 0, scale: 0.6 })
      .set(m2, { opacity: 0 })
      .set(p.querySelectorAll(".sa-charge"), { scaleX: 0, opacity: 1 })
      .add(
        () =>
          p.querySelectorAll(".sa-status").forEach((st) => {
            st.classList.add("is-running");
          }),
        0,
      );
    tl.fromTo(
      intent,
      { opacity: 0, scale: 0.96 },
      { opacity: 1, scale: 1, duration: 0.4, ease: "expo.out" },
      0.15,
    )
      .fromTo(
        launch,
        { opacity: 0, x: -6 },
        { opacity: 1, x: 0, duration: 0.4, ease: "expo.out" },
        0.35,
      )
      .fromTo(
        launch.querySelector(".ic"),
        { scale: 1.6, color: "#fde68a" },
        { scale: 1, color: "#fbbf24", duration: 0.5, ease: "back.out(2)" },
        0.35,
      );
    // fan out from the launch point
    const lr = launch.offsetTop + launch.offsetHeight / 2;
    cards.forEach((c, i) => {
      const dy = lr - (c.offsetTop + c.parentElement.offsetTop + c.offsetHeight / 2);
      tl.fromTo(
        c,
        { opacity: 0, y: dy, scale: 0.9, rotation: (i - 1) * -1.2 },
        { opacity: 1, y: 0, scale: 1, rotation: 0, duration: 0.75, ease: "expo.out" },
        0.55 + i * 0.07,
      );
    });
    cards.forEach((c) => {
      const a = AGI[c.dataset.agent];
      const run = (a.ms / 1000) * SIM;
      const dur = c.querySelector(".dur");
      const o = { v: 0 };
      tl.to(c.querySelector(".sa-charge"), { scaleX: 1, duration: run, ease: "none" }, T0);
      tl.to(
        o,
        {
          v: a.ms,
          duration: run,
          ease: "none",
          onUpdate: () => {
            dur.textContent = fmtDur(o.v);
          },
        },
        T0,
      );
      tl.add(() => {
        const st = c.querySelector(".sa-status");
        st.className = "sa-status";
        gsap.fromTo(st, { scale: 2.2 }, { scale: 1, duration: 0.45, ease: "back.out(2)" });
      }, T0 + run);
      tl.to(c.querySelector(".sa-charge"), { opacity: 0.35, duration: 0.5 }, T0 + run);
      const pill = pills.find((x) => x.dataset.for === a.id);
      tl.to(pill, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)" }, T0 + run + 0.12);
    });
    rows.forEach((r, i) => {
      tl.to(
        r,
        { opacity: 1, x: 0, duration: 0.42, ease: "expo.out" },
        Math.max(T0 + +r.dataset.at * SIM + 0.05, T0 + i * 0.12),
      );
    });
    tl.to(m2, { opacity: 1, duration: 0.6, ease: "power1.out" }, ">-0.1");
    tl.set(p.querySelectorAll(".sa, .tl-row, .cv-pill, .cv-m2, .cv-intent, .cv-launch"), {
      clearProps: "transform,opacity",
    });
    this.track(tl);
    return tl;
  },

  introTodos(p) {
    const tl = gsap.timeline();
    const segs = p.querySelectorAll(".td-bar span");
    const n = p.querySelector(".td-done-n"),
      pct = p.querySelector(".td-pct");
    const o = { v: 0 };
    tl.fromTo(
      segs,
      { scaleX: 0 },
      { scaleX: 1, duration: 0.5, ease: "expo.out", stagger: 0.3 },
      0.1,
    );
    tl.to(
      o,
      {
        v: TODO_COUNTS.done,
        duration: 1.4,
        ease: "power2.out",
        onUpdate: () => {
          n.textContent = Math.round(o.v);
          pct.textContent = `${Math.round((o.v / TODO_COUNTS.total) * 100)}%`;
        },
      },
      0.1,
    );
    const nodes = Array.from(p.querySelectorAll(".td-node"));
    const edges = Array.from(p.querySelectorAll(".td-edge"));
    edges.forEach((e) => {
      const L = e.getTotalLength();
      gsap.set(e, { strokeDasharray: L, strokeDashoffset: L });
    });
    tl.set(nodes, { opacity: 0 }, 0);
    for (let lv = 0; lv <= 4; lv++) {
      const at = 0.25 + lv * 0.42;
      const lvEdges = edges.filter((e) => +e.dataset.lv === lv);
      if (lvEdges.length)
        tl.to(lvEdges, { strokeDashoffset: 0, duration: 0.42, ease: "power1.inOut" }, at - 0.3);
      nodes
        .filter((g) => +g.dataset.lv === lv)
        .forEach((g, i) => {
          const blocked = g.dataset.st === "blocked";
          tl.fromTo(
            g,
            { opacity: 0, y: -6 },
            { opacity: 1, y: 0, duration: 0.45, ease: blocked ? "power2.out" : "expo.out" },
            at + i * 0.06 + (blocked ? 0.2 : 0),
          );
          const tick = g.querySelector(".td-tick");
          if (tick)
            tl.fromTo(
              tick,
              { strokeDasharray: 14, strokeDashoffset: 14 },
              { strokeDashoffset: 0, duration: 0.3, ease: "power2.out" },
              at + 0.22 + i * 0.06,
            );
        });
    }
    tl.set(edges, { clearProps: "strokeDasharray,strokeDashoffset" });
    this.track(tl);
  },
};
