import { D } from "../data.js";
import { ic } from "./icons.js";
import { cursorHTML, esc, libraryContent, placeHighlight, shell } from "./shell.js";

/* ---------- 5. Launch window ---------- */
export const LAUNCH = {
  repo: "checkout-web — C:\\code\\acme\\checkout-web",
  path: "C:\\code\\acme\\checkout-web",
  model: "Claude Opus 5.5",
  prompt:
    "Add saved payment methods to checkout. Reuse the PaymentProvider interface, keep card data in Stripe, and add Playwright coverage for returning customers.",
};
export function buildLaunch(win) {
  const cmdTokens = [
    ["copilot", ""],
    [" \\\n  ", ""],
    ["--model", "k2"],
    [" claude-opus-5.5", ""],
    [" \\\n  ", ""],
    ["--reasoning-effort", "k2"],
    [" high", ""],
    [" \\\n  ", ""],
    ["--interactive", "k2"],
    ...LAUNCH.prompt.split(/(?<= )/).map((w, i) => [(i === 0 ? ' "' : "") + w, "s2"]),
    ['"', "s2"],
  ];
  const cmd = cmdTokens
    .map((t) => `<span class="t${t[1] ? ` ${t[1]}` : ""}">${esc(t[0])}</span>`)
    .join("");
  const newS = {
    id: "new",
    summary: "Add saved payment methods to checkout",
    repository: "acme/checkout-web",
    branch: "feature/apple-pay",
    currentModel: "claude-opus-5.5",
    hostType: "cli",
    eventCount: 3,
    turnCount: 1,
    errorCount: 0,
    compactionCount: 0,
    isRunning: true,
    __extra: { cls: "is-new", ago: "just now" },
  };
  const lib = [newS].concat(D.sessions.slice(0, 11));
  const main = `
    <div class="crumb"><span style="display:contents" class="crumb-ln"><b>Session Launcher</b></span><span class="crumb-alt crumb-lib2" style="opacity:0;background:#0e0e11"><b>Sessions</b></span></div>
    <div class="ln-wrap">
      <div class="ln-form">
        <h3>Launch Session</h3><div class="sub">Configure and launch a new Copilot CLI session</div>
        <div class="ln-label">SAVED TEMPLATES</div>
        <div class="tpls"><div class="tpl">${ic("search")}<b>Multi Agent Code Review</b><p>Comprehensive code review using multiple AI models</p></div>
          <div class="tpl">${ic("flask")}<b>Write Tests</b><p>Generate comprehensive test coverage for recent changes</p></div></div>
        <div class="ln-label">CONFIGURATION</div>
        <div class="panel ln-cfg">
          <div><div class="fld-l"><span>Repository <span class="req">*</span></span><a>Fetch Latest From Remote</a></div>
            <div class="inp" data-f="repo"><span class="ph">Select a repository…</span><span class="val"></span>${ic("chevD")}</div>
            <div class="inp-row"><div class="inp" data-f="path"><span class="ph">Repository path</span><span class="val"></span></div><span class="abtn">Browse</span></div></div>
          <div><div class="fld-l"><span>Branch</span><a>Reset to Default</a></div>
            <div class="inp"><span class="ph">Leave blank to stay on current branch</span>${ic("chevD")}</div>
            <div class="help">Optional — checks out or creates this branch before starting</div></div>
          <div><div class="fld-l"><span>Model</span></div><div class="inp" data-f="model"><span class="ph">Default model</span><span class="val"></span>${ic("chevD")}</div></div>
          <div><div class="fld-l"><span>Reasoning Effort</span></div><div class="eff"><i class="eff-ink"></i><span>Low</span><span>Medium</span><span class="hi">High</span></div></div>
        </div>
        <div class="ln-label">INITIAL PROMPT</div>
        <div class="panel prompt"><div class="ta"><span class="ph">Describe the task…</span><span class="val"></span><i class="caret"></i></div>
          <div class="help">Prompt will be passed to the CLI via <span class="mono">--interactive</span> and executed automatically on session start</div></div>
      </div>
      <div class="ln-side">
        <div class="side-l">LIVE PREVIEW</div>
        <div class="ptiles"><div class="ptile"><small>EST. COST</small><b class="ac">~$0.04</b></div><div class="ptile"><small>MODEL TIER</small><b data-p="tier">Standard</b></div>
          <div class="ptile"><small>ACTIVE SESSIONS</small><b class="gr" data-p="active">0</b></div><div class="ptile"><small>TEMPLATE</small><b>Custom</b></div></div>
        <dl class="pkv">
          <div><dt>Template</dt><dd>Custom</dd></div><div><dt>Repository</dt><dd data-p="repo">—</dd></div><div><dt>Branch</dt><dd>default</dd></div>
          <div><dt>Model</dt><dd data-p="model">Default</dd></div><div><dt>Reasoning</dt><dd data-p="eff">Medium</dd></div>
          <div><dt>Auto-approve</dt><dd class="x">${ic("x")}</dd></div><div><dt>Worktree</dt><dd class="x">${ic("x")}</dd></div>
          <div><dt>Launch Path</dt><dd>Terminal</dd></div><div><dt>Prompt</dt><dd data-p="prompt">—</dd></div></dl>
        <div class="side-l" style="margin-top:14px">COMMAND PREVIEW<span class="copy">${ic("copy")}Copy</span></div>
        <div class="cmd">${cmd}</div>
        <div class="launch-btn">${ic("circlePlay")}Launch Session</div>
      </div>
    </div>
    <div class="lib2" style="opacity:0">${libraryContent(lib, D.sessionCount + 1)}</div>
    ${cursorHTML}`;
  win.innerHTML = shell("launcher", main);
  const app = win.firstElementChild;
  placeHighlight(app, "launcher");
  app.querySelectorAll(".pkv dd.x svg").forEach((s) => {
    s.style.width = "12px";
    s.style.height = "12px";
    s.style.display = "inline-block";
  });
  app.__launch = LAUNCH;
  return app;
}
