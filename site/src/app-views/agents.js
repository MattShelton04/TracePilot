import { D } from "../data.js";
import { fmtInt, shortId } from "../lib/format.js";
import { ic } from "./icons.js";
import { AG, crumbs, dur, esc, fmtK, placeHighlight, shell } from "./shell.js";

/* ---------- 3. Agents window ---------- */
export const SEQ = (() => {
  const T = D.heroTurns[8];
  const tc = (id) => T.toolCalls.find((c) => c.toolCallId === id);
  const start = new Date(D.heroDetail.createdAt).getTime();
  const rel = (iso) => {
    const s = Math.round((new Date(iso).getTime() - start) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const msgs = T.agentMessages;
  const m = (to) => msgs.find((x) => x.recipientToolCallId === to && x.isLaunch);
  return {
    cols: [
      { k: "main", name: "Main agent", type: "main" },
      { k: "review", name: tc("agent-review").agentDisplayName, type: "code-review" },
      { k: "e2e", name: tc("agent-e2e").agentDisplayName, type: "general-purpose" },
      { k: "safari", name: tc("agent-safari").agentDisplayName, type: "explore" },
    ],
    rows: [
      {
        from: "main",
        to: "review",
        kind: "launch",
        t: rel(m("agent-review").timestamp),
        text: m("agent-review").content,
      },
      { from: "main", to: "e2e", kind: "launch", t: "", text: m("agent-e2e").content },
      { from: "main", to: "safari", kind: "launch", t: "", text: m("agent-safari").content },
      {
        from: "safari",
        to: "main",
        kind: "read",
        t: rel(tc("read-safari").startedAt),
        text: tc("agent-safari").resultContent,
      },
      {
        from: "main",
        to: "e2e",
        kind: "worker",
        t: rel(tc("write-e2e").startedAt),
        text: tc("write-e2e").arguments.message,
      },
      {
        from: "review",
        to: "e2e",
        kind: "peer",
        t: rel(tc("write-peer").startedAt),
        text: tc("write-peer").arguments.message,
      },
      {
        from: "review",
        to: "main",
        kind: "read",
        t: rel(tc("read-review").startedAt),
        text: tc("agent-review").resultContent,
      },
      {
        from: "e2e",
        to: "main",
        kind: "read",
        t: rel(tc("read-e2e").startedAt),
        text: tc("agent-e2e").resultContent.replace(/`/g, ""),
      },
    ],
    tree: {
      main: {
        name: "Main Agent",
        model: T.model,
        dur: dur(T.durationMs),
        tools: T.toolCalls.filter((c) => !c.parentToolCallId).length,
      },
      kids: ["review", "e2e", "safari"].map((k) => {
        const c = tc(`agent-${k}`);
        return {
          k,
          name: c.agentDisplayName,
          model: c.model,
          dur: dur(c.durationMs),
          tools: T.toolCalls.filter((x) => x.parentToolCallId === c.toolCallId).length,
          tok: fmtK(c.totalTokens),
        };
      }),
    },
  };
})();
export const MC = { launch: "#a1a1aa", worker: "#818cf8", peer: "#fb923c", read: "#a78bfa" };

export function buildAgents(win) {
  const W = 1172,
    H = 580; // canvas inner size (app px; collapsed sidebar)
  const colX = [206, 460, 714, 968]; // column centres
  const rowY = (i) => 168 + i * 50;
  const treeMain = { x: W / 2, y: 92, w: 268 };
  const kidX = [W / 2 - 300, W / 2, W / 2 + 300],
    kidY = 300,
    kidW = 236;
  const colOf = (k) => SEQ.cols.findIndex((c) => c.k === k);

  const node = (
    k,
    n,
    x,
    y,
    w,
    extra,
  ) => `<div class="tnode" data-node="${k}" style="left:${x - w / 2}px;top:${y}px;width:${w}px;--ac:${AG[k].color}">
      ${extra || ""}<div class="tnode-h">${ic(AG[k].icon)}<span style="overflow:hidden;text-overflow:ellipsis">${esc(n.name)}</span></div>
      <div class="tnode-m">${n.model}</div><div class="tnode-s"><span>${n.dur}</span><span>${n.tools} tools</span>${n.tok ? `<span class="dim">${n.tok} tok</span>` : ""}</div>
      <span class="tnode-ok">${ic("check")}</span></div>`;
  const conn = SEQ.tree.kids
    .map((kd, i) => {
      const x1 = treeMain.x,
        y1 = treeMain.y + 86,
        x2 = kidX[i],
        y2 = kidY;
      return `<path d="M${x1} ${y1} C ${x1} ${y1 + 70}, ${x2} ${y2 - 70}, ${x2} ${y2}" stroke="${AG[kd.k].color}" stroke-opacity=".75"/>`;
    })
    .join("");
  const tree = `<div class="layer tree-layer">
      <div class="turnnav"><span>${ic("chevsL")} Earliest</span><span>${ic("chevL")} Prev</span><b>Turn ${D.agentTurn} (${D.agentTurnCount} of ${D.agentTurnCount} with agents)</b><span class="ac">Next ${ic("chevR")}</span><span class="ac">Latest ${ic("chevsR")}</span></div>
      <svg class="tree-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${conn}</svg>
      ${node("main", SEQ.tree.main, treeMain.x, treeMain.y, treeMain.w)}
      ${SEQ.tree.kids.map((kd, i) => node(kd.k, kd, kidX[i], kidY, kidW, '<span class="pg-badge">Parallel Group A</span>')).join("")}
    </div>`;

  const heads = SEQ.cols
    .map(
      (c, i) =>
        `<div class="colhead" data-col="${c.k}" style="left:${colX[i]}px;--ac:${AG[c.k].color}"><b><i></i><span>${esc(c.name)}</span></b><small>${c.type}</small></div>`,
    )
    .join("");
  const lifelines = colX.map((x, _i) => `<i class="lifeline" style="left:${x}px"></i>`).join("");
  // activation bars
  const span = (k, a, b) => {
    const i = colOf(k);
    return `<i class="act" data-act="${k}" style="left:${colX[i]}px;top:${rowY(a) - 6}px;height:${rowY(b) - rowY(a) + 12}px;--ac:${AG[k].color}"></i>`;
  };
  const acts = span("main", 0, 7) + span("review", 0, 6) + span("e2e", 1, 7) + span("safari", 2, 3);
  const rows = SEQ.rows
    .map((r, i) => {
      const a = colX[colOf(r.from)],
        b = colX[colOf(r.to)],
        l = Math.min(a, b),
        w = Math.abs(b - a),
        right = b > a;
      return `<div class="msgrow" data-i="${i}" style="left:${l}px;top:${rowY(i)}px;width:${w}px;--mc:${MC[r.kind]}" data-dir="${right ? "r" : "l"}">
      <div class="msglabel">${esc(r.text)}</div><i class="msgline${r.kind === "read" ? " dashed" : ""}"></i><i class="msghead ${right ? "r" : "l"}"></i></div>`;
    })
    .join("");
  const tlabels = SEQ.rows
    .map((r, i) => (r.t ? `<span class="tlabel" style="top:${rowY(i) - 7}px">${r.t}</span>` : ""))
    .join("");
  const seq = `<div class="layer seq-layer">
      <div class="seq-tools"><div class="seg"><i class="seg-ink" style="width:84px"></i><span class="on">Sequence</span><span>Lanes</span><span>Graph</span></div>
        <span class="fchip">Launches <i>3</i></span><span class="fchip">Messages <i>2</i></span><span class="fchip">Reads <i>3</i></span>
        <span class="inp" style="width:220px;margin-left:4px"><span class="val" style="font-weight:600">All agents</span>${ic("chevD")}</span></div>
      <div class="seq-sum"><span><b>2</b> messages</span><span><b>1</b> peer</span><span><b>2</b> queued</span><span><b>3</b> reads</span>
        <span class="legend"><span><i style="border-color:${MC.launch}"></i>Launch prompt</span><span><i style="border-color:${MC.worker}"></i>To worker</span><span><i style="border-color:${MC.peer}"></i>Peer</span><span><i style="border-color:${MC.read};border-top-style:dashed"></i>Read back</span></span></div>
      ${heads}<i class="colhead-rule"></i>${lifelines}${acts}${tlabels}${rows}<i class="scanline" style="top:${rowY(0)}px"></i><i class="marker" style="top:${rowY(0)}px"></i>
    </div>`;

  const main = `
    <div class="crumb">${crumbs("Sessions", esc(D.heroDetail.summary), "Timeline")}</div>
    <div class="content tl">
      <div class="tl-head"><div><h3>Session Timeline</h3><p>Visual timeline of session events and interactions</p></div>
        <div class="seg seg-views"><i class="seg-ink"></i><span data-v="swim">Swimlanes</span><span data-v="water">Waterfall</span><span data-v="tree" class="on">Agent Tree</span><span data-v="msg">Messages</span></div></div>
      <div class="infobar panel">ID <span class="mono">${shortId(D.heroDetail.id)}</span><span class="chip c-model">${D.heroDetail.currentModel}</span>TURNS <b>${D.heroDetail.turnCount}</b> EVENTS <b>${fmtInt(D.heroDetail.eventCount)}</b></div>
    </div>
    <div class="tl-canvas panel" style="top:${40 + 18 + 48 + 14 + 38 + 14}px">${tree}${seq}</div>`;
  win.innerHTML = shell("sessions", main, true);
  const app = win.firstElementChild;
  placeHighlight(app, "sessions");
  const mainAct = app.querySelector('.act[data-act="main"]');
  if (mainAct) {
    mainAct.style.width = "6px";
    mainAct.style.marginLeft = "-3px";
    mainAct.style.opacity = ".35";
  }
  placeSeg(app);
  app.__geo = { colX, rowY, treeMain, kidX, kidY, kidW, colOf };
  return app;
}

export function placeSeg(app) {
  const segInk = app.querySelector(".seg-views .seg-ink"),
    segTree = app.querySelector('.seg-views [data-v="tree"]');
  segInk.style.width = `${segTree.offsetWidth}px`;
  segInk.style.transform = `translateX(${segTree.offsetLeft}px)`;
}
