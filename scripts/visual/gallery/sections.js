// Navigation helpers are bundled into the standalone report before gallery.js.
globalThis.TracePilotGallerySections = (() => {
  const text = (tag, content, className) => {
    const node = document.createElement(tag);
    node.textContent = content;
    if (className) node.className = className;
    return node;
  };
  // Review order: changes first, then limitations, subtle and identical views.
  const groups = [
    ["changed", "Review changes"],
    ["incomplete", "Incomplete"],
    ["base unavailable", "Base unavailable"],
    ["subtle", "Subtle differences"],
    ["unchanged", "Identical"],
  ];
  const rank = (row) => {
    const index = groups.findIndex(([status]) => status === row.change);
    return index < 0 ? groups.length : index;
  };
  const orderRows = (rows) => [...rows].sort((a, b) => rank(a) - rank(b));
  const firstInSection = (rows, id) => {
    const items = rows.filter((row) => row.group === id);
    return (
      items.find((row) => row.change === "changed") ??
      items.find((row) => row.change === "subtle") ??
      items[0]
    );
  };
  function mountButtons({ sections, rows, container, onSelect }) {
    const buttons = new Map();
    for (const item of sections) {
      const items = rows.filter((row) => row.group === item.id);
      const changes = items.filter((row) => row.change === "changed").length;
      const limits = items.filter((row) =>
        ["incomplete", "base unavailable"].includes(row.change),
      ).length;
      const button = text("button", "", "section-link");
      button.type = "button";
      button.setAttribute("aria-label", item.label);
      button.append(
        text("span", `${item.label} · ${items.length}`),
        text(
          "small",
          `${changes} to review · ${limits} limitations`,
          limits ? "section-limited" : "",
        ),
      );
      button.addEventListener("click", () => onSelect(item.id));
      buttons.set(item.id, button);
      container.append(button);
    }
    return buttons;
  }
  return { text, groups, orderRows, firstInSection, mountButtons };
})();
