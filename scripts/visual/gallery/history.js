(() => {
  const { entries } = JSON.parse(document.getElementById("report-data").textContent);
  const view = document.getElementById("history-view"),
    kind = document.getElementById("history-kind");
  const search = document.getElementById("history-search"),
    grid = document.getElementById("history-grid");
  const ids = [...new Set(entries.flatMap((entry) => entry.views ?? ["sessions"]))].sort();
  const requested = new URLSearchParams(location.hash.slice(1)).get("view");
  for (const id of ids) view.add(new Option(id, id));
  view.value = ids.includes(requested) ? requested : ids.includes("sessions") ? "sessions" : ids[0];
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function render() {
    const filtered = entries.filter(
      (entry) =>
        (kind.value === "all" || (kind.value === "pr") === Boolean(entry.pr)) &&
        `${entry.title} ${entry.sha} ${entry.created}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    );
    grid.replaceChildren();
    document.getElementById("history-count").textContent =
      `${filtered.length} retained runs · ${view.value || "no views"}`;
    for (const entry of filtered) {
      const card = element("article", "", "run-card"),
        info = element("div", "", "run-info");
      const url = `runs/${entry.id}/index.html?attempt=${entry.attempt}#view=${encodeURIComponent(view.value)}`;
      if ((entry.views ?? ["sessions"]).includes(view.value)) {
        const link = element("a", ""),
          image = element("img", "");
        link.href = url;
        link.setAttribute("aria-label", `Open ${view.value} at ${entry.sha.slice(0, 8)}`);
        image.src = `runs/${entry.id}/head-${view.value}.png?attempt=${entry.attempt}`;
        image.alt = `${view.value}, after ${entry.sha.slice(0, 8)}`;
        image.loading = "lazy";
        link.append(image);
        card.append(link);
      }
      info.append(element("h2", entry.title));
      info.append(element("p", `${entry.created} · attempt ${entry.attempt ?? 1}`));
      const s = entry.summary;
      if (s)
        info.append(
          element(
            "p",
            `${s.changed} PNG changes · ${s.unchanged} identical · ${s.incomplete + s.baseUnavailable} limitations`,
          ),
        );
      const link = element("a", "Open comparison →");
      link.href = url;
      info.append(link);
      card.append(info);
      grid.append(card);
    }
    history.replaceState(null, "", `#view=${encodeURIComponent(view.value)}`);
  }
  view.addEventListener("change", render);
  kind.addEventListener("change", render);
  search.addEventListener("input", render);
  render();
})();
