import { D } from "../data.js";
import { Flip, gsap } from "../lib/gsap.js";
import { ic } from "./icons.js";
import { esc, RM } from "./shared.js";
import { PROMPT } from "./views-pages.js";
import { sessionCard } from "./views-session.js";

export const demoMethods = {
  /* ---------- search ---------- */
  searchReset() {
    const v = this.getView("search");
    v.querySelector(".q").textContent = "";
    v.querySelector(".sr-found-t").innerHTML =
      D.search.get_search_stats.totalRows.toLocaleString("en-US") +
      " indexed rows across " +
      D.search.get_search_stats.indexedSessions +
      " sessions";
    gsap.set(v.querySelectorAll(".sr-res"), { opacity: 0, y: 14 });
    gsap.set(v.querySelectorAll(".sr-facet .n"), { opacity: 0 });
  },
  searchFinal(animate) {
    const v = this.getView("search");
    v.querySelector(".q").textContent = D.searchQuery;
    v.querySelector(".sr-found-t").innerHTML =
      "Found <b>" +
      D.search.search_content.totalCount +
      '</b> results <span class="ms">(' +
      D.search.search_content.latencyMs +
      "ms)</span>";
    if (animate && !RM) {
      this.track(
        gsap.fromTo(
          v.querySelectorAll(".sr-res"),
          { opacity: 0, y: 14 },
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            ease: "expo.out",
            stagger: 0.06,
            clearProps: "transform,opacity",
          },
        ),
      );
      this.track(
        gsap.fromTo(
          v.querySelectorAll(".sr-facet .n"),
          { opacity: 0 },
          { opacity: 1, duration: 0.4, stagger: 0.03 },
        ),
      );
    } else
      gsap.set(v.querySelectorAll(".sr-res, .sr-facet .n"), { clearProps: "transform,opacity" });
  },
  async searchDemo(tok) {
    const v = this.getView("search");
    this.searchReset();
    const q = v.querySelector(".q");
    const word = D.searchQuery;
    if (!(await this.wait(380, tok))) return false;
    const tl = gsap.timeline();
    tl.to(
      v.querySelectorAll(".sr-syn .shine"),
      { x: "120%", duration: 0.9, ease: "power2.inOut", stagger: 0.06 },
      0,
    );
    const o = { n: 0 };
    tl.to(
      o,
      {
        n: word.length,
        duration: word.length * 0.075,
        ease: "none",
        onUpdate: () => {
          q.textContent = word.slice(0, Math.round(o.n));
        },
      },
      0.1,
    );
    this.track(tl);
    if (!(await this.done(tl, tok))) return false;
    if (!(await this.wait(140, tok))) return false;
    const found = v.querySelector(".sr-found-t");
    found.innerHTML =
      "Found <b>" +
      D.search.search_content.totalCount +
      '</b> results <span class="ms">(' +
      D.search.search_content.latencyMs +
      "ms)</span>";
    const t2 = gsap.timeline();
    t2.fromTo(
      found,
      { opacity: 0, y: 4 },
      { opacity: 1, y: 0, duration: 0.35, ease: "expo.out" },
      0,
    );
    t2.fromTo(
      found.querySelector(".ms"),
      { color: "#a7f3d0", textShadow: "0 0 12px rgba(52,211,153,.9)" },
      { color: "#34d399", textShadow: "0 0 0 rgba(52,211,153,0)", duration: 0.9 },
      0.1,
    );
    t2.to(v.querySelectorAll(".sr-facet .n"), { opacity: 1, duration: 0.3, stagger: 0.03 }, 0.05);
    const res = Array.from(v.querySelectorAll(".sr-res"));
    res.forEach((r, i) => {
      const at = 0.12 + i * 0.1;
      t2.to(r, { opacity: 1, y: 0, duration: 0.55, ease: "expo.out" }, at);
      r.querySelectorAll("mark").forEach((m) => {
        t2.fromTo(
          m,
          { backgroundSize: "0% 100%", color: "#fafafa" },
          { backgroundSize: "100% 100%", color: "#18181b", duration: 0.45, ease: "power2.out" },
          at + 0.25,
        );
      });
    });
    t2.set(res, { clearProps: "transform,opacity" });
    this.track(t2);
    return this.done(t2, tok);
  },

  /* ---------- launcher ---------- */
  launcherReset() {
    const v = this.getView("launcher");
    v.querySelector(".ln-repo").innerHTML =
      `<span class="ph">Select a repository…</span>${ic("chevD", 14)}`;
    v.querySelector(".ln-pathv").innerHTML = '<span class="ph">Path</span>';
    v.querySelector(".ln-model").innerHTML =
      `<span class="ph">Default model</span>${ic("chevD", 14)}`;
    v.querySelector(".ln-ptext").textContent = "";
    v.querySelector(".ln-textarea .ph").style.display = "";
    v.querySelector(".ln-cmd-t").innerHTML = "copilot";
    v.querySelector(".kv-repo").textContent = "—";
    v.querySelector(".kv-model").textContent = "—";
    v.querySelector(".kv-prompt").textContent = "—";
    v.querySelector(".kv-eff").textContent = "Medium";
    v.querySelector(".ln-cost").textContent = "—";
    v.querySelector(".ln-tier").textContent = "—";
    v.querySelector(".ln-active").textContent = "1";
    this.setEffort(v, 1, false);
    const go = v.querySelector(".ln-go");
    go.innerHTML = `${ic("play", 15)}<span>Launch Session</span>`;
  },
  setEffort(v, i, anim) {
    const ind = v.querySelector(".ln-effort i");
    v.querySelectorAll(".ln-effort span").forEach((s) => {
      s.classList.toggle("is-on", +s.dataset.e === i);
    });
    const x = `${i * 100}%`;
    if (anim && !RM)
      this.track(gsap.to(ind, { xPercent: i * 100, duration: 0.32, ease: "expo.out" }));
    else gsap.set(ind, { xPercent: i * 100 });
    void x;
  },
  cmdHTML(prompt, upto) {
    const parts = [
      ["copilot", ""],
      [" \\\n  ", ""],
      ["--model", "f"],
      [" claude-opus-5.5", ""],
      [" \\\n  ", ""],
      ["--reasoning-effort", "f"],
      [" high", ""],
      [" \\\n  ", ""],
      ["--interactive", "f"],
      [` ${prompt}`, "s"],
    ];
    let out = "",
      left = upto == null ? 1e9 : upto;
    for (const p of parts) {
      if (left <= 0) break;
      const t = p[0].slice(0, left);
      left -= p[0].length;
      out += p[1] ? `<span class="${p[1]}">${esc(t)}</span>` : esc(t);
    }
    return out;
  },
  launcherFinal() {
    const v = this.getView("launcher");
    v.querySelector(".ln-repo").innerHTML =
      `<span>checkout-web — C:\\code\\acme\\checkout-web</span>${ic("chevD", 14)}`;
    v.querySelector(".ln-pathv").innerHTML = "<span>C:\\code\\acme\\checkout-web</span>";
    v.querySelector(".ln-model").innerHTML = `<span>Claude Opus 5.5</span>${ic("chevD", 14)}`;
    v.querySelector(".ln-ptext").textContent = PROMPT;
    v.querySelector(".ln-textarea .ph").style.display = "none";
    v.querySelector(".ln-cmd-t").innerHTML = this.cmdHTML(PROMPT);
    v.querySelector(".kv-repo").textContent = "C:\\code\\acme\\checkout-web";
    v.querySelector(".kv-model").textContent = "Claude Opus 5.5";
    v.querySelector(".kv-eff").textContent = "High";
    v.querySelector(".kv-prompt").textContent = PROMPT;
    v.querySelector(".ln-cost").textContent = "~$0.04";
    v.querySelector(".ln-tier").textContent = "Premium";
    this.setEffort(v, 2, false);
  },
  async fillSelect(el, html, tok) {
    if (!(await this.cursorClick(el, tok))) return false;
    el.innerHTML = html;
    if (!RM)
      this.track(
        gsap.fromTo(
          el,
          { borderColor: "rgba(129,140,248,0.9)", boxShadow: "0 0 0 3px rgba(99,102,241,0.18)" },
          {
            borderColor: "rgba(255,255,255,0.1)",
            boxShadow: "0 0 0 0 rgba(99,102,241,0)",
            duration: 0.7,
            ease: "power2.out",
            clearProps: "borderColor,boxShadow",
          },
        ),
      );
    return true;
  },
  async launcherDemo(tok) {
    const v = this.getView("launcher");
    this.launcherReset();
    if (!(await this.wait(350, tok))) return false;
    if (
      !(await this.fillSelect(
        v.querySelector(".ln-repo"),
        `<span>checkout-web — C:\\code\\acme\\checkout-web</span>${ic("chevD", 14)}`,
        tok,
      ))
    )
      return false;
    v.querySelector(".ln-pathv").innerHTML = "<span>C:\\code\\acme\\checkout-web</span>";
    v.querySelector(".kv-repo").textContent = "C:\\code\\acme\\checkout-web";
    if (
      !(await this.fillSelect(
        v.querySelector(".ln-model"),
        `<span>Claude Opus 5.5</span>${ic("chevD", 14)}`,
        tok,
      ))
    )
      return false;
    v.querySelector(".kv-model").textContent = "Claude Opus 5.5";
    v.querySelector(".ln-cost").textContent = "~$0.04";
    v.querySelector(".ln-tier").textContent = "Premium";
    if (!(await this.cursorClick(v.querySelector('.ln-effort [data-e="2"]'), tok))) return false;
    this.setEffort(v, 2, true);
    v.querySelector(".kv-eff").textContent = "High";
    // type prompt + command preview together
    const ta = v.querySelector(".ln-ptext");
    const cmd = v.querySelector(".ln-cmd-t");
    if (!(await this.cursorClick(v.querySelector(".ln-textarea"), tok))) return false;
    this.hideCursor();
    v.querySelector(".ln-textarea .ph").style.display = "none";
    const head =
      "copilot \\\n  --model claude-opus-5.5 \\\n  --reasoning-effort high \\\n  --interactive "
        .length;
    const o = { n: 0, c: 0 };
    const tl = gsap.timeline();
    tl.to(
      o,
      {
        c: head,
        duration: 0.9,
        ease: "none",
        onUpdate: () => {
          cmd.innerHTML = this.cmdHTML("", Math.round(o.c));
        },
      },
      0,
    );
    tl.to(
      o,
      {
        n: PROMPT.length,
        duration: 2.4,
        ease: "none",
        onUpdate: () => {
          const n = Math.round(o.n);
          const s = PROMPT.slice(0, n);
          ta.textContent = s;
          cmd.innerHTML = this.cmdHTML(s, head + n);
          v.querySelector(".kv-prompt").textContent = s || "—";
        },
      },
      0.5,
    );
    this.track(tl);
    if (!(await this.done(tl, tok))) return false;
    if (!(await this.wait(250, tok))) return false;
    return this.doLaunch(tok, true);
  },
  async doLaunch(tok, tour) {
    const v = this.getView("launcher");
    const go = v.querySelector(".ln-go");
    if (tour && !(await this.cursorClick(go, tok))) return false;
    if (!v.querySelector(".ln-ptext").textContent) this.launcherFinal();
    go.innerHTML = `${ic("loader", 15, 'style="animation:rpSpin .8s linear infinite"')}<span>Launching…</span>`;
    if (!(await this.wait(650, tok))) return false;
    go.innerHTML = `${ic("check", 15)}<span>Launched</span>`;
    v.querySelector(".ln-active").textContent = "2";
    this.toast("Launched in Windows Terminal · checkout-web");
    if (!(await this.wait(1100, tok))) return false;
    const navBtn = this.root.querySelector('.rp-nav-item[data-nav="sessions"]');
    if (tour && !(await this.cursorClick(navBtn, tok))) return false;
    this.showView("sessions", { intro: false });
    if (!(await this.wait(380, tok))) return false;
    this.addLaunchedCard();
    return true;
  },
  toast(text) {
    const t = document.createElement("div");
    t.className = "rp-toast";
    t.innerHTML = `${ic("check", 16)}<span>${esc(text)}</span>`;
    this.root.appendChild(t);
    const tl = gsap.timeline({ onComplete: () => t.remove() });
    tl.fromTo(
      t,
      { opacity: 0, y: 14, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "expo.out" },
    ).to(t, { opacity: 0, y: 6, duration: 0.3 }, "+=2.2");
    if (RM) tl.progress(1);
  },
  addLaunchedCard() {
    if (this.launched) return;
    const lib = this.getView("sessions");
    const grid = lib.querySelector(".lib-grid");
    const cards = Array.from(grid.children);
    const s = {
      id: "new-session",
      summary: "Add saved payment methods to checkout",
      repository: "acme/checkout-web",
      branch: "main",
      currentModel: "claude-opus-5.5",
      hostType: "cli",
      eventCount: 14,
      turnCount: 1,
      errorCount: 0,
      compactionCount: 0,
      isRunning: true,
      timeLabel: "just now",
    };
    const wrap = document.createElement("div");
    wrap.innerHTML = sessionCard(s, "is-new");
    const card = wrap.firstChild;
    card.removeAttribute("data-session");
    const state = !RM ? Flip.getState(cards) : null;
    grid.insertBefore(card, grid.firstChild);
    this.launched = true;
    if (state) {
      this.track(Flip.from(state, { duration: 0.7, ease: "expo.inOut", stagger: 0.012 }));
      this.track(
        gsap.fromTo(
          card,
          { opacity: 0, scale: 0.86, y: -18 },
          {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: 0.7,
            delay: 0.25,
            ease: "back.out(1.4)",
            clearProps: "transform,opacity",
          },
        ),
      );
    }
  },
  resetLaunched() {
    if (!this.launched) return;
    const n = this.views.sessions?.querySelector(".is-new");
    if (n) n.remove();
    this.launched = false;
  },
};
