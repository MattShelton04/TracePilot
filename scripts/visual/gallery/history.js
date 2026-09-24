(() => {
  const { entries, repo } = JSON.parse(document.getElementById("report-data").textContent);
  const $ = (id) => document.getElementById(id);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const link = (href, text, className) => {
    const node = element("a", text, className);
    node.href = href;
    return node;
  };
  const runUrl = (entry, view, mode) =>
    `runs/${entry.id}/index.html?attempt=${entry.attempt}${view ? `#view=${encodeURIComponent(view)}${mode ? `&mode=${mode}` : ""}` : ""}`;
  const imageUrl = (name) => `img/${name}`;
  const date = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
          timeZoneName: "short",
        });
  };
  const changedViews = (entry) =>
    Object.entries(entry.changes ?? {})
      .filter(([, status]) => status === "changed")
      .map(([id]) => id);
  const ordered = [...entries].sort((a, b) => b.id - a.id);

  function counts(entry) {
    const row = element("div", "", "counts");
    const s = entry.summary;
    if (!s) return row;
    const pill = (text, className) => row.append(element("span", text, `count ${className}`));
    pill(
      `${s.changed} review ${s.changed === 1 ? "change" : "changes"}`,
      s.changed ? "changed" : "",
    );
    pill(`${s.subtle ?? 0} subtle`, "");
    pill(`${s.unchanged} identical`, "unchanged");
    const limits = s.incomplete + s.baseUnavailable;
    if (limits) pill(`${limits} limitations`, "limited");
    return row;
  }
  // Difference thumbnails show where each changed view moved.
  function previews(entry, limit) {
    const strip = element("div", "", "preview-strip");
    const views = changedViews(entry);
    for (const view of views.slice(0, limit)) {
      const figure = link(runUrl(entry, view, "difference"), "", "preview");
      const name = entry.previews?.[view] ?? entry.images?.[view];
      if (name) {
        const image = element("img");
        image.src = imageUrl(name);
        image.alt = `${view}: changed pixels highlighted`;
        image.loading = "lazy";
        figure.append(image);
      }
      figure.append(element("span", view, "preview-label"));
      strip.append(figure);
    }
    if (views.length > limit) {
      const more = element("div", "", "more-views");
      for (const view of views.slice(limit))
        more.append(link(runUrl(entry, view, "difference"), view, "chip"));
      strip.append(more);
    }
    if (!views.length) strip.append(element("p", "No review changes in this run.", "quiet"));
    return strip;
  }
  const sha = (entry) => entry.sha.slice(0, 8);
  const matches = (entry, query) =>
    !query ||
    `${entry.pr ? `#${entry.pr} pr ${entry.pr}` : "main"} ${entry.sha} ${entry.created} ${Object.keys(entry.changes ?? {}).join(" ")}`
      .toLowerCase()
      .includes(query);

  function renderPrs(query) {
    const list = $("pr-list");
    list.replaceChildren();
    const byPr = new Map();
    for (const entry of ordered.filter((entry) => entry.pr))
      byPr.set(entry.pr, [...(byPr.get(entry.pr) ?? []), entry]);
    let shown = 0;
    for (const [pr, runs] of byPr) {
      if (!runs.some((entry) => matches(entry, query))) continue;
      const [latest, ...earlier] = runs;
      const card = element("article", "", "pr-card");
      const heading = element("div", "", "card-heading");
      const title = element("h2");
      title.append(
        repo
          ? link(`https://github.com/${repo}/pull/${pr}`, `PR #${pr}`)
          : element("span", `PR #${pr}`),
      );
      heading.append(title, element("span", `${sha(latest)} · ${date(latest.created)}`, "meta"));
      card.append(heading, counts(latest), previews(latest, 3));
      const actions = element("div", "", "card-actions");
      actions.append(link(runUrl(latest), "Open latest comparison →"));
      card.append(actions);
      if (earlier.length) {
        const details = element("details", "", "earlier");
        details.append(
          element(
            "summary",
            `${earlier.length} earlier ${earlier.length === 1 ? "push" : "pushes"}`,
          ),
        );
        const items = element("ul");
        for (const entry of earlier) {
          const item = element("li");
          const s = entry.summary;
          item.append(
            link(runUrl(entry), sha(entry)),
            element(
              "span",
              ` · ${date(entry.created)}${s ? ` · ${s.changed} review · ${s.subtle ?? 0} subtle` : ""}`,
            ),
          );
          items.append(item);
        }
        details.append(items);
        card.append(details);
      }
      list.append(card);
      shown++;
    }
    return shown;
  }

  function renderMain(query) {
    const list = $("main-list");
    list.replaceChildren();
    let shown = 0;
    for (const entry of ordered.filter((entry) => !entry.pr && matches(entry, query))) {
      const item = element("li", "", "main-row");
      const when = element("div", "", "main-when");
      when.append(
        link(runUrl(entry), sha(entry), "sha"),
        element("span", date(entry.created), "meta"),
      );
      const body = element("div", "", "main-body");
      body.append(counts(entry), previews(entry, 4));
      item.append(when, body);
      list.append(item);
      shown++;
    }
    return shown;
  }

  const allViews = [
    ...new Set(
      ordered.flatMap((entry) => Object.keys(entry.images ?? {}).concat(entry.views ?? [])),
    ),
  ].sort();
  const requested = new URLSearchParams(location.hash.slice(1));
  for (const id of allViews) $("timeline-view").add(new Option(id, id));
  $("timeline-view").value = allViews.includes(requested.get("view"))
    ? requested.get("view")
    : allViews.includes("sessions")
      ? "sessions"
      : (allViews[0] ?? "");
  if (requested.get("scope") === "all") $("timeline-scope").value = "all";

  function renderTimeline(query) {
    const list = $("timeline-list");
    list.replaceChildren();
    const view = $("timeline-view").value;
    const runs = ordered.filter(
      (entry) =>
        ($("timeline-scope").value === "all" || !entry.pr) &&
        entry.images?.[view] &&
        matches(entry, query),
    );
    // Oldest first to find where the view's pixels changed, then newest first.
    const changes = [];
    let previous;
    for (const entry of [...runs].reverse()) {
      if (entry.images[view] !== previous) changes.push({ entry, same: 0 });
      else changes.at(-1).same++;
      previous = entry.images[view];
    }
    for (const { entry, same } of changes.reverse()) {
      const card = element("article", "", "timeline-card");
      const image = element("img");
      image.src = imageUrl(entry.images[view]);
      image.alt = `${view} after ${sha(entry)}`;
      image.loading = "lazy";
      const figure = link(runUrl(entry, view), "");
      figure.append(image);
      const info = element("div", "", "timeline-info");
      const status = entry.changes?.[view];
      const label = {
        changed: "Changed against its base",
        subtle: "Subtle difference against its base",
        incomplete: "Capture incomplete",
        "base unavailable": "No base screenshot to compare",
      }[status];
      info.append(
        element("h2", `${entry.pr ? `PR #${entry.pr}` : "Main"} · ${sha(entry)}`),
        element("p", date(entry.created), "meta"),
        element("p", label ?? "Identical to its base", `status ${status ?? ""}`),
      );
      if (same)
        info.append(
          element("p", `Same pixels in ${same} earlier ${same === 1 ? "run" : "runs"}`, "quiet"),
        );
      info.append(
        link(runUrl(entry, view, entry.changes?.[view] ? "difference" : ""), "Open comparison →"),
      );
      card.append(figure, info);
      list.append(card);
    }
    const skipped = ordered.filter((entry) => !entry.images?.[view]).length;
    if (skipped)
      list.append(
        element(
          "p",
          `${skipped} retained ${skipped === 1 ? "run has" : "runs have"} no usable screenshot of this view.`,
          "quiet",
        ),
      );
    return changes.length;
  }

  const tabs = ["prs", "main", "timeline"];
  let tab = tabs.includes(requested.get("tab"))
    ? requested.get("tab")
    : ordered.some((entry) => entry.pr)
      ? "prs"
      : "main";
  function render() {
    const query = $("history-search").value.trim().toLowerCase();
    for (const id of tabs) {
      $(`tab-${id}`).setAttribute("aria-selected", String(id === tab));
      $(`tab-${id}`).tabIndex = id === tab ? 0 : -1;
      $(`panel-${id}`).hidden = id !== tab;
    }
    const shown = { prs: renderPrs, main: renderMain, timeline: renderTimeline }[tab](query);
    $("history-empty").hidden = shown > 0;
    const state = new URLSearchParams({ tab });
    if (tab === "timeline") {
      state.set("view", $("timeline-view").value);
      if ($("timeline-scope").value === "all") state.set("scope", "all");
    }
    history.replaceState(null, "", `#${state}`);
  }
  for (const id of tabs) {
    $(`tab-${id}`).addEventListener("click", () => {
      tab = id;
      render();
    });
    $(`tab-${id}`).addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      tab = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      render();
      $(`tab-${tab}`).focus();
    });
  }
  // Older gallery links point here with only #view=…; open that view's timeline.
  if (requested.get("view") && !requested.get("tab")) tab = "timeline";
  $("history-search").addEventListener("input", render);
  $("timeline-view").addEventListener("change", render);
  $("timeline-scope").addEventListener("change", render);
  render();
})();
