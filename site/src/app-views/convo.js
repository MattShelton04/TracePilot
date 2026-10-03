import { D } from "../data.js";
import { lat } from "../lib/format.js";
import { ic } from "./icons.js";
import { AG, clock, crumbs, dur, esc, fmtK, shell, toolbar } from "./shell.js";

export function buildConvo(win) {
  const T = D.heroTurns[8],
    T9 = D.heroTurns[9];
  const tc = (id) => T.toolCalls.find((c) => c.toolCallId === id);
  const kids = (id) => T.toolCalls.filter((c) => c.parentToolCallId === id).length;
  const agents = [
    ["review", tc("agent-review")],
    ["e2e", tc("agent-e2e")],
    ["safari", tc("agent-safari")],
  ];
  const cards = agents
    .map(
      ([k, c]) => `
    <div class="acard" data-agent="${k}" data-ms="${c.durationMs}" style="--ac:${AG[k].color}"><i class="acard-top"></i><i class="acard-charge"></i>
      <div class="acard-r1"><span class="abadge">${ic(AG[k].icon)}${esc(c.agentDisplayName)}</span><b>${esc(c.agentDisplayName)}</b>
        <span class="ameta"><span>${c.model}</span><span class="dur">${dur(c.durationMs)}</span><i class="adot"><i class="adot-done"></i></i>${ic("chevR")}</span></div>
      <div class="acard-r2">${kids(c.toolCallId)} tool call${kids(c.toolCallId) > 1 ? "s" : ""} inside · ${fmtK(c.totalTokens)} tok · ${c.totalToolCalls} tool execs</div></div>`,
    )
    .join("");
  // rows land in order, at the second (from the agents' launch) that the call started
  const t0 = new Date(tc("agent-review").startedAt).getTime();
  let lastAt = 0;
  const row = (key, icon, id, label) => {
    const c = tc(id);
    lastAt = Math.max(lastAt + 2, Math.round((new Date(c.startedAt).getTime() - t0) / 1000));
    return [key, icon, c.toolName, label, lat(c.durationMs), lastAt];
  };
  const rows = [
    row(
      "write",
      "send",
      "write-e2e",
      `→ ${tc("agent-e2e").agentDisplayName} · ${tc("write-e2e").arguments.message}`,
    ),
    row("read-safari", "inbox", "read-safari", tc("agent-safari").agentDisplayName),
    row("read-review", "inbox", "read-review", tc("agent-review").agentDisplayName),
    row("read-e2e", "inbox", "read-e2e", tc("agent-e2e").agentDisplayName),
  ]
    .map(
      (r) =>
        `<div class="trow" data-row="${r[0]}" data-at="${r[5]}">${ic(r[1])}<b>${r[2]}</b><span class="arg">${esc(r[3])}</span><span class="lat">${r[4]}</span>${ic("check", "ok")}${ic("chevR")}</div>`,
    )
    .join("");
  const pills = ["safari", "review", "e2e"]
    .map((k) => [k, tc(`agent-${k}`).durationMs])
    .map(
      ([k, ms]) =>
        `<span class="pill-done" data-pill="${k}">${ic("check")}${AG[k].label} agent completed <span class="d">${dur(ms)}</span></span>`,
    )
    .join("");
  const diffLines = [
    [
      "hunk",
      "",
      "",
      "",
      "@@ -54,9 +54,12 @@ export class ApplePayProvider implements PaymentProvider {",
    ],
    [
      "",
      "54",
      "54",
      " ",
      '  <span class="k">private</span> <span class="f">begin</span>(request: <span class="ty">ApplePayPaymentRequest</span>) {',
    ],
    [
      "",
      "55",
      "55",
      " ",
      '    <span class="k">const</span> session = <span class="k">new</span> <span class="ty">ApplePaySession</span>(<span class="s">14</span>, request);',
    ],
    ["", "56", "56", " ", '    session.<span class="p">oncancel</span> = () =&gt; {'],
    [
      "del",
      "57",
      "",
      "-",
      '      <span class="k">this</span>.<span class="f">emit</span>(<span class="s">\'cancelled\'</span>);',
    ],
    [
      "add",
      "",
      "57",
      "+",
      '      <span class="cm">// Release the merchant session so a retry can validate again.</span>',
    ],
    [
      "add",
      "",
      "58",
      "+",
      '      <span class="k">this</span>.<span class="p">merchantSession</span> = <span class="k">undefined</span>;',
    ],
    [
      "add",
      "",
      "59",
      "+",
      '      <span class="k">this</span>.<span class="p">session</span> = <span class="k">undefined</span>;',
    ],
    [
      "add",
      "",
      "60",
      "+",
      '      <span class="k">this</span>.<span class="f">emit</span>(<span class="s">\'cancelled\'</span>);',
    ],
    ["", "58", "61", " ", "    };"],
  ]
    .map(
      (l) =>
        `<div class="dl ${l[0]}"><span class="ln">${l[1]}</span><span class="ln">${l[2]}</span><span class="sg">${l[3]}</span><span class="code">${l[4]}</span></div>`,
    )
    .join("");

  const main = `
    <div class="crumb">${crumbs("Sessions", esc(D.heroDetail.summary), "Conversation")}</div>
    <div class="content cv">${toolbar()}
      <div class="cv-viewport"><div class="cv-scroll">
        <div class="turn turn-user" data-b="user"><i class="rail"></i><div class="msg-head">${ic("user")}<span class="who-user">User</span><span class="tn">T8</span><time>${clock(T.timestamp)}</time></div>
          <div class="user-box">${esc(T.userMessage)}</div></div>
        <div class="turn turn-asst" data-b="asst"><i class="rail"></i>
          <div class="asst-msg" data-b="a1"><div class="msg-head">${ic("bot")}<span>Copilot</span><time>${clock(T.timestamp)}</time></div><p>${esc(T.assistantMessages[0].content)}</p></div>
          <div class="intent" data-b="intent">${ic("target")}Reviewing changes</div>
          <div class="par-head" data-b="par">${ic("zap")}3 agents launched in parallel</div>
          <div class="par-group"><i class="par-rail"></i>${cards}</div>
          <div class="trows">${rows}</div>
          <div class="pills">${pills}</div>
          <div class="asst-msg" data-b="a2"><div class="msg-head">${ic("bot")}<span>Copilot</span><time>${clock(T.endTimestamp)}</time></div><p>${esc(T.assistantMessages[1].content)}</p></div>
        </div>
        <div class="turn turn-user" data-b="user9"><i class="rail"></i><div class="msg-head">${ic("user")}<span class="who-user">User</span><span class="tn">T9</span><time>${clock(T9.timestamp)}</time></div>
          <div class="user-box">${esc(T9.userMessage)}</div></div>
        <div class="turn turn-asst" data-b="a9"><i class="rail"></i>
          <div class="intent">${ic("target")}Fixing review finding</div>
          <div class="tcall">${ic("pencil")}<b>edit</b><span class="path">src/payments/providers/applePay.ts</span><span class="lat">60ms</span>${ic("check", "ok")}</div>
          <div class="diff"><div class="diff-h"><span>applePay.ts</span><span class="add">+4</span><span class="del">−1</span></div>${diffLines}</div>
        </div>
      </div></div>
    </div>`;
  win.innerHTML = shell("sessions", main, true);
  const app = win.firstElementChild;
  return app;
}
