import { D, VERSION } from "../data.js";
import { gsap } from "../lib/gsap.js";
import { demoMethods } from "./demos.js";
import { EYE, ic } from "./icons.js";
import { introMethods } from "./intros.js";
import { chartIntroMethods } from "./intros-charts.js";
import { esc, HAND, HERO, NAV, RM, TABS, TITLES } from "./shared.js";
import { stepMethods } from "./steps.js";
import { transitionMethods } from "./transitions.js";
import { viewAnalytics, viewCode, viewModels, viewSkills, viewTools } from "./views-analytics.js";
import { viewAgents, viewStub, viewWorktrees } from "./views-misc.js";
import {
  PROMPT,
  viewLauncher,
  viewSearch,
  viewSessionDetail,
  viewSessionLite,
} from "./views-pages.js";
import { viewSessions } from "./views-session.js";

/* ============================================================ Replica */
let UID = 0;

/* One Replica instance is one app window. The page drives it through runStep();
   visitors can click anything inside it ("free" mode). */
export class Replica {
  constructor(host, opts) {
    this.o = Object.assign(
      { w: 1180, h: 780, collapsed: false, interactive: true, cursor: true },
      opts || {},
    );
    this.uid = `rp${++UID}`;
    this.W = this.o.w;
    this.H = this.o.h;
    this.run = 0;
    this.anims = new Set();
    this.mode = "tour";
    this.views = {};
    this.view = null;
    this.tab = "overview";
    this.tlMode = "tree";
    this.liteId = null;
    this.cacheLeft = 225;
    this.clockOn = false;
    this.launched = false;
    this.onUser = null;
    this.onState = null;
    this.build(host);
    this.showView("sessions", { anim: false, intro: false });
  }

  /* ---------- shell ---------- */
  build(host) {
    const r = document.createElement("div");
    r.className = `rp${this.o.collapsed ? " is-collapsed" : ""}`;
    r.style.setProperty("--rp-w", `${this.W}px`);
    r.style.setProperty("--rp-h", `${this.H}px`);
    if (!this.o.interactive) {
      r.setAttribute("aria-hidden", "true");
      r.setAttribute("inert", "");
    }
    let nav = "";
    NAV.forEach((n) => {
      if (n === "-") nav += '<div class="rp-nav-sep"></div>';
      else if (typeof n === "string")
        nav += `<div class="rp-nav-section">${n}</div><div class="rp-nav-section-gap"></div>`;
      else
        nav +=
          '<button type="button" class="rp-nav-item" data-nav="' +
          n[0] +
          '" title="' +
          n[1] +
          '"><span class="ic-wrap" style="display:inline-flex">' +
          ic(n[2], 16) +
          "</span><span>" +
          n[1] +
          "</span>" +
          (n[3] || "") +
          "</button>";
    });
    r.innerHTML =
      '<div class="rp-titlebar"><span style="display:inline-flex;width:14px;height:14px;border-radius:3px;background:var(--gradient-accent);align-items:center;justify-content:center">' +
      EYE.replace('width="17" height="17"', 'width="11" height="11"') +
      '</span><span class="rp-tb-title">TracePilot</span><span class="rp-tb-controls"><span>' +
      ic("minus", 14) +
      "</span><span>" +
      ic("square", 11) +
      "</span><span>" +
      ic("x", 14) +
      "</span></span></div>" +
      '<div class="rp-body"><nav class="rp-sidebar" aria-label="TracePilot navigation (replica)">' +
      '<div class="rp-brand"><span class="rp-brand-icon">' +
      EYE +
      '</span><span class="rp-brand-text">TracePilot</span><span class="rp-brand-collapse">' +
      ic("chevL", 15) +
      "</span></div>" +
      '<div class="rp-nav">' +
      nav +
      "</div>" +
      '<div class="rp-sidebar-foot"><span class="rp-version">v' +
      VERSION +
      '</span><span class="rp-themebtn">' +
      ic("sun", 14) +
      "</span></div></nav>" +
      '<div class="rp-main"><div class="rp-crumbs"></div><div class="rp-views"></div></div></div>' +
      '<div class="rp-cursor" aria-hidden="true"><span class="ring"></span><svg class="c-arrow" viewBox="0 0 24 24"><path d="M4.5 2.5 19 12.6l-6.6 1.3 3.9 7.2-2.6 1.4-3.9-7.3-5.3 4.3z" fill="#fafafa" stroke="#09090b" stroke-width="1.3" stroke-linejoin="round"/></svg><svg class="c-hand" viewBox="0 0 24 24">' +
      HAND +
      "</svg></div>";
    host.appendChild(r);
    this.root = r;
    this.el = {
      crumbs: r.querySelector(".rp-crumbs"),
      views: r.querySelector(".rp-views"),
      cursor: r.querySelector(".rp-cursor"),
    };
    if (this.o.interactive) {
      r.addEventListener("click", (e) => this.onClick(e));
    }
  }
  setSize(w, h) {
    this.W = w;
    this.H = h;
    this.root.style.setProperty("--rp-w", `${w}px`);
    this.root.style.setProperty("--rp-h", `${h}px`);
    if (this.view === "session") this.placeInk(false);
  }
  scale() {
    return this.root.getBoundingClientRect().width / this.W || 1;
  }

  /* ---------- run control ---------- */
  newRun() {
    this.run++;
    const list = Array.from(this.anims);
    this.anims.clear();
    list.forEach((a) => {
      a.progress(1);
      a.kill();
    });
    return this.run;
  }
  track(a) {
    this.anims.add(a);
    if (RM) a.progress(1);
    return a;
  }
  wait(ms, tok) {
    return new Promise((res) => {
      if (RM) return res(this.run === tok);
      const d = gsap.delayedCall(ms / 1000, () => res(this.run === tok));
      this.anims.add(d);
    });
  }
  done(a, tok) {
    return new Promise((res) => {
      if (a.progress() === 1) return res(this.run === tok);
      a.eventCallback("onComplete", () => res(this.run === tok));
    });
  }

  /* ---------- user input ---------- */
  takeOver() {
    if (this.mode === "free") return;
    this.mode = "free";
    this.newRun();
    this.settle();
    this.hideCursor();
    if (this.onUser) this.onUser();
  }
  onClick(e) {
    if (e.isTrusted) this.takeOver();
    const t = e.target.closest(
      "[data-nav],[data-session],[data-tab],[data-tl],[data-crumb],[data-act]",
    );
    if (!t || !this.root.contains(t)) return;
    if (t.hasAttribute("disabled")) return;
    if (e.isTrusted) this.newRun();
    if (t.dataset.nav) {
      this.navTo(t.dataset.nav);
    } else if (t.dataset.session) {
      if (t.dataset.session === HERO.id) {
        if (this.view === "sessions" && t.classList.contains("scard"))
          this.openSession(t, this.run, t.dataset.gotoTab);
        else {
          this.showView("session", { tab: t.dataset.gotoTab || "overview" });
        }
      } else this.openLite(t.dataset.session);
    } else if (t.dataset.tab) {
      this.setTab(t.dataset.tab);
    } else if (t.dataset.tl) {
      this.setTlMode(t.dataset.tl);
    } else if (t.dataset.crumb) {
      if (t.dataset.crumb === "sessions") this.navTo("sessions");
      else if (t.dataset.crumb === "session") this.setTab("overview");
    } else if (t.dataset.act === "launch") {
      this.doLaunch(this.run, false);
    }
  }

  /* Complete any half-played demo so free mode never shows a partial state. */
  settle() {
    if (this.view === "search") {
      const q = this.views.search.querySelector(".q");
      if (q.textContent !== D.searchQuery) this.searchFinal(true);
      else
        gsap.set(this.views.search.querySelectorAll(".sr-res, .sr-facet .n"), {
          clearProps: "transform,opacity",
        });
    }
    if (this.view === "launcher") {
      const t = this.views.launcher.querySelector(".ln-ptext");
      if (t.textContent !== PROMPT) this.launcherFinal();
    }
  }

  /* ---------- chrome ---------- */
  setActiveNav(name) {
    const navName = name === "session" || name === "lite" ? "sessions" : name;
    this.root.querySelectorAll(".rp-nav-item").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.nav === navName);
    });
  }
  renderCrumbs() {
    const sep = `<span class="sep">${ic("chevR", 13)}</span>`;
    let h;
    if (this.view === "session") {
      const t = TABS.find((x) => x[0] === this.tab)[1];
      h =
        '<button type="button" data-crumb="sessions">Sessions</button>' +
        sep +
        '<button type="button" data-crumb="session">' +
        esc(HERO.summary) +
        "</button>" +
        sep +
        '<span class="cur">' +
        t +
        "</span>";
    } else if (this.view === "lite") {
      const s = D.sessions.find((x) => x.id === this.liteId);
      h =
        '<button type="button" data-crumb="sessions">Sessions</button>' +
        sep +
        '<span class="cur">' +
        esc(s ? s.summary : "") +
        "</span>";
    } else h = `<span class="cur">${TITLES[this.view]}</span>`;
    this.el.crumbs.innerHTML = h;
  }

  /* ---------- views ---------- */
  getView(name) {
    if (this.views[name]) return this.views[name];
    const v = document.createElement("section");
    v.className = `rp-view${name === "session" || name === "lite" ? " rp-view--detail" : ""}`;
    v.dataset.view = name;
    v.hidden = true;
    const html = {
      sessions: viewSessions,
      session: () => viewSessionDetail(this.uid),
      search: viewSearch,
      launcher: viewLauncher,
      analytics: viewAnalytics,
      tools: viewTools,
      code: viewCode,
      models: viewModels,
      skills: viewSkills,
      agents: viewAgents,
      worktrees: viewWorktrees,
      compare: () => viewStub("compare"),
      export: () => viewStub("export"),
      command: () => viewStub("command"),
      settings: () => viewStub("settings"),
      lite: () => "",
    }[name];
    v.innerHTML = html();
    this.el.views.appendChild(v);
    this.views[name] = v;
    return v;
  }

  navTo(name, opts) {
    if (name === "sessions" && this.view === "sessions") return;
    this.showView(name, opts);
  }

  showView(name, opts) {
    opts = opts || {};
    const anim = opts.anim !== false && !RM;
    const prev = this.view ? this.views[this.view] : null;
    const next = this.getView(name);
    this.view = name;
    this.setActiveNav(name);
    if (name === "session") {
      if (opts.tab) this.tab = opts.tab;
    }
    this.renderCrumbs();
    if (prev && prev !== next) {
      if (anim) {
        this.track(
          gsap.to(prev, {
            opacity: 0,
            duration: 0.16,
            ease: "power1.out",
            onComplete: () => {
              prev.hidden = true;
              gsap.set(prev, { clearProps: "opacity" });
            },
          }),
        );
      } else {
        prev.hidden = true;
      }
    }
    next.hidden = false;
    next.scrollTop = 0;
    if (anim && prev !== next)
      this.track(
        gsap.fromTo(
          next,
          { opacity: 0, y: 10 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            delay: 0.08,
            ease: "expo.out",
            clearProps: "transform",
          },
        ),
      );
    if (name === "session") {
      this.startClock();
      this.setTab(this.tab, { anim: false, intro: opts.intro !== false, force: true });
    }
    if (opts.intro !== false) this.introView(name, opts);
    if (this.onState) this.onState();
  }

  openLite(id) {
    const s = D.sessions.find((x) => x.id === id);
    if (!s) return;
    this.liteId = id;
    const v = this.getView("lite");
    v.innerHTML = viewSessionLite(s);
    this.showView("lite");
    const ink = v.querySelector(".sd-ink");
    const t = v.querySelector('.sd-tab[data-ltab="overview"]');
    t.classList.add("is-active");
    gsap.set(ink, { x: t.offsetLeft, scaleX: t.offsetWidth / 100 });
  }
}

Object.assign(
  Replica.prototype,
  transitionMethods,
  introMethods,
  chartIntroMethods,
  demoMethods,
  stepMethods,
);
