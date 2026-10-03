import { gsap } from "../lib/gsap.js";
import { HERO, RM } from "./shared.js";

export const stepMethods = {
  /* ---------- ghost cursor ---------- */
  localPoint(el, fx, fy) {
    const r = el.getBoundingClientRect(),
      R = this.root.getBoundingClientRect(),
      S = R.width / this.W;
    return {
      x: (r.left + r.width * (fx == null ? 0.5 : fx) - R.left) / S,
      y: (r.top + r.height * (fy == null ? 0.55 : fy) - R.top) / S,
    };
  },
  async ensureVisible(el, tok) {
    const view = el.closest(".rp-view");
    if (!view) return true;
    const vr = view.getBoundingClientRect(),
      r = el.getBoundingClientRect();
    const S = this.scale();
    if (r.top >= vr.top + 40 && r.bottom <= vr.bottom - 20) return true;
    const target = view.scrollTop + (r.top - vr.top) / S - view.clientHeight * 0.35;
    const tw = gsap.to(view, {
      scrollTop: Math.max(0, target),
      duration: 0.5,
      ease: "power2.inOut",
    });
    this.track(tw);
    return this.done(tw, tok);
  },
  async cursorTo(el, tok, fx, fy) {
    if (!this.o.cursor || RM) return this.run === tok;
    if (!(await this.ensureVisible(el, tok))) return false;
    const p = this.localPoint(el, fx, fy);
    const cur = this.el.cursor;
    if (+gsap.getProperty(cur, "opacity") < 0.05)
      gsap.set(cur, { x: p.x + 90, y: p.y + 80, "--hand": 0 });
    const tw = gsap
      .timeline()
      .to(cur, { x: p.x, y: p.y, opacity: 1, duration: 0.62, ease: "power3.inOut" }, 0)
      .to(cur, { "--hand": 0, duration: 0.12 }, 0)
      .to(cur, { "--hand": 1, duration: 0.14 }, 0.5);
    this.track(tw);
    return this.done(tw, tok);
  },
  async cursorClick(el, tok) {
    if (!(await this.cursorTo(el, tok))) return false;
    if (!this.o.cursor || RM) return true;
    const cur = this.el.cursor;
    const ring = cur.querySelector(".ring");
    el.classList.add("rp-press");
    this.track(
      gsap.fromTo(
        ring,
        { scale: 0.3, opacity: 0.9 },
        { scale: 1.5, opacity: 0, duration: 0.45, ease: "power2.out" },
      ),
    );
    this.track(
      gsap.fromTo(
        cur.querySelectorAll("svg"),
        { scale: 0.84 },
        { scale: 1, duration: 0.3, ease: "back.out(2)", transformOrigin: "40% 8%" },
      ),
    );
    const ok = await this.wait(140, tok);
    el.classList.remove("rp-press");
    return ok;
  },
  hideCursor() {
    gsap.to(this.el.cursor, { opacity: 0, duration: 0.3 });
  },

  /* ---------- detail scroll helper ---------- */
  scrollDetail(toTabs, tok) {
    const det = this.views.session;
    const wrap = det.querySelector(".sd-tabs-wrap");
    const target = toTabs ? wrap.offsetTop : 0;
    if (Math.abs(det.scrollTop - target) < 4) return Promise.resolve(true);
    const tw = gsap.to(det, { scrollTop: target, duration: RM ? 0 : 0.6, ease: "power2.inOut" });
    this.track(tw);
    return this.done(tw, tok);
  },

  /* ---------- guided tour ---------- */
  async runStep(id) {
    const tok = this.newRun();
    this.mode = "tour";
    const sessionTab = {
      open: "overview",
      conversation: "conversation",
      tree: "timeline",
      messages: "timeline",
      context: "context",
      metrics: "metrics",
      todos: "todos",
    };
    if (id === "library" || id === "open") this.resetLaunched();

    if (id === "library") {
      if (this.view !== "sessions") {
        const nb = this.root.querySelector('.rp-nav-item[data-nav="sessions"]');
        if (!(await this.cursorClick(nb, tok))) return;
        this.showView("sessions");
      }
      const cards = this.views.sessions.querySelectorAll(".scard");
      if (!(await this.wait(300, tok))) return;
      if (!(await this.cursorTo(cards[2], tok, 0.6, 0.4))) return;
      cards[2].classList.add("is-hover");
      if (!(await this.wait(500, tok))) {
        cards[2].classList.remove("is-hover");
        return;
      }
      cards[2].classList.remove("is-hover");
      if (!(await this.cursorTo(cards[0], tok, 0.62, 0.42))) return;
      cards[0].classList.add("is-hover");
      const clear = () => cards[0].classList.remove("is-hover");
      this.anims.add(gsap.delayedCall(30, clear));
      this.root.addEventListener("pointermove", clear, { once: true });
      return;
    }

    if (sessionTab[id]) {
      const tab = sessionTab[id];
      if (this.view !== "session") {
        if (this.view !== "sessions") {
          this.showView("sessions", { intro: false });
          if (!(await this.wait(260, tok))) return;
        }
        const card = this.views.sessions.querySelector(`.scard[data-session="${HERO.id}"]`);
        card.classList.remove("is-hover");
        if (!(await this.cursorClick(card, tok))) return;
        if (!(await this.openSession(card, tok, id === "open" ? "overview" : "overview"))) return;
        if (id === "open") {
          this.hideCursor();
          return;
        }
        if (!(await this.wait(350, tok))) return;
      }
      const det = this.views.session;
      const needsScroll = id === "conversation" || id === "messages" || id === "todos";
      if (this.tab !== tab) {
        if (!(await this.scrollDetail(false, tok))) return;
        const te = det.querySelector(`.sd-tab[data-tab="${tab}"]`);
        if (!(await this.cursorClick(te, tok))) return;
        this.setTab(tab, { intro: tab !== "timeline" && !needsScroll });
      } else if (tab !== "timeline" && !needsScroll) {
        this.introPanel(tab);
      }
      if (tab === "timeline") {
        const want = id === "messages" ? "messages" : "tree";
        if (needsScroll) {
          if (!(await this.wait(200, tok))) return;
          if (!(await this.scrollDetail(true, tok))) return;
        } else if (!(await this.scrollDetail(false, tok))) return;
        if (this.tlMode !== want) {
          if (!(await this.wait(220, tok))) return;
          const b = det.querySelector(`[data-tl="${want}"]`);
          if (!(await this.cursorClick(b, tok))) return;
          this.setTlMode(want);
        } else this.introTimeline(want);
      } else if (needsScroll) {
        if (!(await this.wait(120, tok))) return;
        if (!(await this.scrollDetail(true, tok))) return;
        this.introPanel(tab);
      } else {
        if (!(await this.scrollDetail(false, tok))) return;
      }
      if (!(await this.wait(400, tok))) return;
      this.hideCursor();
      return;
    }

    if (id === "search" || id === "launch") {
      const name = id === "search" ? "search" : "launcher";
      if (this.view !== name) {
        const nb = this.root.querySelector(`.rp-nav-item[data-nav="${name}"]`);
        if (!(await this.cursorClick(nb, tok))) return;
        this.showView(name, { demo: true });
      }
      if (!(await this.wait(250, tok))) return;
      if (id === "search") {
        this.hideCursor();
        await this.searchDemo(tok);
      } else {
        await this.launcherDemo(tok);
        if (this.run === tok) this.hideCursor();
      }
    }
  },

  /* Instantly show the end state of a step (used for mobile frames before they play). */
  setInstant(id) {
    const tok = this.newRun();
    void tok;
    const sessionTab = {
      open: "overview",
      conversation: "conversation",
      tree: "timeline",
      messages: "timeline",
      context: "context",
      metrics: "metrics",
      todos: "todos",
    };
    if (id === "library") this.showView("sessions", { anim: false, intro: false });
    else if (sessionTab[id]) {
      this.tlMode = id === "messages" ? "messages" : "tree";
      this.showView("session", { anim: false, intro: false, tab: sessionTab[id] });
    } else if (id === "search") {
      this.showView("search", { anim: false, intro: false });
      this.searchFinal(false);
    } else if (id === "launch") {
      this.showView("launcher", { anim: false, intro: false });
      this.launcherFinal();
    }
    this.newRun();
  },
};
