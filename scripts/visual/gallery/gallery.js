(() => {
  const report = JSON.parse(document.getElementById("report-data").textContent);
  const $ = (id) => document.getElementById(id);
  const imageVersion = `?attempt=${report.metadata.attempt}`;
  const modes = ["side", "toggle", "wipe", "overlay", "difference"];
  const rows = report.rows,
    byId = new Map(rows.map((row) => [row.id, row]));
  const params = new URLSearchParams(location.hash.slice(1));
  let selected =
    byId.get(params.get("view")) ??
    rows.find((row) => row.change === "changed") ??
    rows.find((row) => row.change === "subtle") ??
    rows[0];
  let mode = modes.includes(params.get("mode")) ? params.get("mode") : "side";
  let zoom = params.get("zoom") === "100" ? 1 : "fit",
    scale = 1,
    generation = 0;
  let images = {},
    analysis = null,
    displayedSide = "head",
    lastWidth = 0,
    lastHeight = 0;
  const viewport = $("viewport"),
    stage = $("image-stage"),
    scaled = $("scaled-stage");
  const buttons = new Map();
  const text = (tag, content, className) => {
    const node = document.createElement(tag);
    node.textContent = content;
    if (className) node.className = className;
    return node;
  };
  const both = () => images.base && images.head;
  const dimensions = () => ({ width: mode === "side" && both() ? 2904 : 1440, height: 960 });
  function urlState(push = false) {
    const query = new URLSearchParams({ view: selected.id, mode });
    if (zoom === 1) query.set("zoom", "100");
    history[push ? "pushState" : "replaceState"](null, "", `#${query}`);
    $("history-link").href = `../../index.html#view=${encodeURIComponent(selected.id)}`;
  }
  function filter() {
    let visible = 0;
    for (const row of rows) {
      const matches =
        `${row.id} ${row.route} ${row.state}`
          .toLowerCase()
          .includes($("search").value.toLowerCase()) &&
        (!$("changes").checked || !["unchanged", "subtle"].includes(row.change));
      buttons.get(row.id).hidden = !matches;
      if (matches) visible++;
    }
    $("visible-count").textContent = `${visible} of ${rows.length} views`;
    $("empty-filter").hidden = visible > 0;
  }
  for (const row of rows) {
    const button = text("button", "", "view-link");
    button.type = "button";
    button.setAttribute("aria-label", `${row.id}, ${row.change}`);
    const thumb = document.createElement("img");
    thumb.className = "view-thumb";
    thumb.alt = "";
    thumb.loading = "lazy";
    if (row.headHash || row.baseHash)
      thumb.src = `${row.headHash ? "head" : "base"}-${row.id}.png${imageVersion}`;
    else thumb.hidden = true;
    const label = text("span", "");
    label.append(
      text("span", row.id, "view-name"),
      text("span", row.change, `view-status ${row.change}`),
    );
    button.append(thumb, label);
    button.addEventListener("click", () => select(row, true));
    buttons.set(row.id, button);
    $("view-list").append(button);
  }
  const noMatches = text("p", "No views match these filters.", "empty-filter");
  noMatches.id = "empty-filter";
  $("view-list").append(noMatches);
  $("search").addEventListener("input", filter);
  $("changes").addEventListener("change", filter);

  function fitScale() {
    const size = dimensions();
    return Math.min(
      (viewport.clientWidth - 52) / size.width,
      (viewport.clientHeight - 52) / size.height,
      1,
    );
  }
  function resize(center = false) {
    const oldScale = scale,
      oldLeft = viewport.scrollLeft,
      oldTop = viewport.scrollTop;
    const size = dimensions();
    scale = zoom === "fit" ? Math.max(0.08, fitScale()) : zoom;
    stage.style.width = `${size.width}px`;
    stage.style.height = `${size.height}px`;
    stage.style.transform = `scale(${scale})`;
    scaled.style.width = `${size.width * scale}px`;
    scaled.style.height = `${size.height * scale}px`;
    viewport.classList.toggle("can-pan", scale > fitScale() + 0.01);
    $("zoom-value").textContent = `${Math.round(scale * 100)}%`;
    $("zoom-fit").setAttribute("aria-pressed", String(zoom === "fit"));
    $("zoom-actual").setAttribute("aria-pressed", String(zoom === 1));
    $("zoom-out").disabled = scale <= 0.1;
    $("zoom-in").disabled = scale >= 4;
    if (zoom === "fit") {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    } else if (center && oldScale) {
      viewport.scrollLeft =
        ((oldLeft + viewport.clientWidth / 2) * scale) / oldScale - viewport.clientWidth / 2;
      viewport.scrollTop =
        ((oldTop + viewport.clientHeight / 2) * scale) / oldScale - viewport.clientHeight / 2;
    }
    updateWipe();
  }
  function setZoom(value) {
    zoom = value;
    resize(true);
    urlState();
  }
  $("zoom-fit").addEventListener("click", () => setZoom("fit"));
  $("zoom-actual").addEventListener("click", () => setZoom(1));
  $("zoom-in").addEventListener("click", () => setZoom(Math.min(4, scale * 1.25)));
  $("zoom-out").addEventListener("click", () => setZoom(Math.max(0.1, scale / 1.25)));
  new ResizeObserver(() => {
    if (lastWidth === viewport.clientWidth && lastHeight === viewport.clientHeight) return;
    lastWidth = viewport.clientWidth;
    lastHeight = viewport.clientHeight;
    resize();
  }).observe(viewport);

  function imageNode(side) {
    const node = images[side].cloneNode();
    node.alt = `${side === "base" ? "Before" : "After"}: ${selected.id}`;
    node.draggable = false;
    return node;
  }
  function board(side, label = true) {
    const node = text("div", "", "board");
    node.append(imageNode(side));
    if (label)
      node.append(
        text(
          "span",
          side === "base" ? "BEFORE / BASE" : "AFTER / HEAD",
          `board-label ${side === "head" ? "after" : ""}`,
        ),
      );
    return node;
  }
  function updateWipe() {
    const value = Number($("wipe-range").value);
    $("wipe-value").textContent = `${value}%`;
    const layer = $("wipe-layer"),
      line = $("wipe-line"),
      grip = $("wipe-grip");
    if (layer) layer.style.clipPath = `inset(0 0 0 ${value}%)`;
    if (line) line.style.left = `${value}%`;
    if (grip) {
      grip.setAttribute("aria-valuenow", String(value));
      grip.setAttribute("aria-valuetext", `${value}% before, ${100 - value}% after`);
      grip.style.transform = `translate(-50%,-50%) scale(${1 / Math.max(scale, 0.2)})`;
    }
  }
  function wipeBoard() {
    const node = board("base");
    const after = imageNode("head");
    after.id = "wipe-layer";
    node.append(after, text("span", "AFTER / HEAD", "board-label after"));
    const line = text("div", "", "wipe-line");
    line.id = "wipe-line";
    const grip = text("button", "↔", "wipe-grip");
    grip.id = "wipe-grip";
    grip.type = "button";
    for (const [key, value] of Object.entries({
      role: "separator",
      "aria-label": "Before and after split",
      "aria-orientation": "vertical",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
    }))
      grip.setAttribute(key, value);
    grip.addEventListener("keydown", (event) => {
      const old = Number($("wipe-range").value),
        step = event.shiftKey ? 10 : 1;
      const value = { ArrowLeft: old - step, ArrowRight: old + step, Home: 0, End: 100 }[event.key];
      if (value === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      $("wipe-range").value = Math.max(0, Math.min(100, value));
      updateWipe();
    });
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      grip.setPointerCapture(event.pointerId);
      grip.focus({ preventScroll: true });
    });
    grip.addEventListener("pointermove", (event) => {
      if (!grip.hasPointerCapture(event.pointerId)) return;
      const rect = node.getBoundingClientRect();
      $("wipe-range").value = Math.max(
        0,
        Math.min(100, (100 * (event.clientX - rect.left)) / rect.width),
      );
      updateWipe();
    });
    grip.addEventListener("pointerup", (event) => {
      if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    });
    line.append(grip);
    node.append(line);
    return node;
  }
  function renderStage() {
    stage.replaceChildren();
    for (const button of document.querySelectorAll("[data-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
      button.disabled = !both() && ["wipe", "overlay", "difference"].includes(button.dataset.mode);
    }
    $("toggle-controls").hidden = mode !== "toggle";
    $("wipe-control").hidden = mode !== "wipe";
    $("opacity-control").hidden = mode !== "overlay";
    $("threshold-control").hidden = mode !== "difference";
    $("mode-hint").textContent = {
      side: "Compare the same desktop viewport",
      toggle: "Switch images without moving the viewport",
      wipe: "Drag the divider or use its arrow keys",
      overlay: "Adjust opacity to reveal alignment changes",
      difference: "Pink pixels changed · rectangles mark changed areas",
    }[mode];
    for (const button of document.querySelectorAll("[data-side]")) {
      button.setAttribute("aria-pressed", String(button.dataset.side === displayedSide));
      button.disabled = !images[button.dataset.side];
    }
    if (!images.base && !images.head) {
      stage.append(
        text(
          "p",
          "No usable image is available. Review the capture limitations below.",
          "empty-message",
        ),
      );
      resize();
      return;
    }
    if (!both()) stage.append(board(images.head ? "head" : "base"));
    else if (mode === "side") stage.append(board("base"), board("head"));
    else if (mode === "toggle") stage.append(board(displayedSide));
    else if (mode === "wipe") stage.append(wipeBoard());
    else {
      const node = board(mode === "overlay" ? "base" : "head", false);
      if (mode === "overlay") {
        const after = imageNode("head");
        after.id = "opacity-layer";
        after.style.opacity = Number($("opacity").value) / 100;
        node.append(after);
      } else if (analysis) {
        node.firstChild.style.opacity = ".48";
        if (analysis.heatFile) {
          const heat = new Image();
          heat.src = `${analysis.heatFile}${imageVersion}`;
          heat.alt = "Changed pixels shown in pink";
          node.append(heat);
        }
        for (const area of analysis.regions) {
          const bounds = text("div", "", "bounds");
          Object.assign(bounds.style, {
            left: `${area.x}px`,
            top: `${area.y}px`,
            width: `${area.width}px`,
            height: `${area.height}px`,
          });
          node.append(bounds);
        }
      }
      stage.append(node);
    }
    resize();
  }
  for (const button of document.querySelectorAll("[data-mode]"))
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      renderStage();
      urlState();
    });
  for (const button of document.querySelectorAll("[data-side]"))
    button.addEventListener("click", () => {
      displayedSide = button.dataset.side;
      renderStage();
    });
  $("wipe-range").addEventListener("input", updateWipe);
  $("opacity").addEventListener("input", () => {
    $("opacity-value").textContent = `${$("opacity").value}%`;
    if ($("opacity-layer")) $("opacity-layer").style.opacity = Number($("opacity").value) / 100;
  });
  $("threshold").addEventListener("change", () => {
    if (both()) {
      generation++;
      analyze(generation);
    }
  });

  function showAnalysis(result) {
    analysis = result;
    $("regions").replaceChildren();
    const exact = Number($("threshold").value) === 0;
    $("pixel-metric").textContent =
      `${result.changed.toLocaleString()} / ${result.total.toLocaleString()} pixels changed (${result.percent.toFixed(3)}%)${exact ? " · exact RGBA comparison" : ` · threshold ${$("threshold").value}`} · precomputed from PNGs`;
    $("pixel-bounds").textContent =
      selected.change === "subtle"
        ? `Subtle: at most 128 pixels, each channel ≤ 8/255. ${result.description}`
        : result.description;
    result.regions.forEach((area, index) => {
      const button = text(
        "button",
        `Region ${index + 1} · ${area.x},${area.y} · ${area.width}×${area.height}`,
      );
      button.title = `${area.pixels.toLocaleString()} changed pixels; tight bounds of nearby changes (8px grouping)`;
      button.addEventListener("click", () => {
        mode = "difference";
        zoom = 1;
        renderStage();
        viewport.scrollLeft = Math.max(0, 26 + area.x + area.width / 2 - viewport.clientWidth / 2);
        viewport.scrollTop = Math.max(0, 26 + area.y + area.height / 2 - viewport.clientHeight / 2);
        urlState();
      });
      $("regions").append(button);
    });
    if (result.regionCount > 12)
      $("regions").append(
        text("span", `${result.regionCount - 12} smaller regions omitted`, "view-description"),
      );
    // Analysis may finish while a reviewer drags the wipe or focuses a control.
    if (mode === "difference") renderStage();
    else resize();
  }
  async function analyze(token) {
    analysis = null;
    $("regions").replaceChildren();
    $("pixel-bounds").textContent = "";
    if (!both()) {
      $("pixel-metric").textContent = "Pixel comparison needs a usable before and after image.";
      renderStage();
      return;
    }
    $("pixel-metric").textContent = "Loading pixel comparison…";
    if (mode === "difference") renderStage();
    try {
      // Trusted report data and PNG overlays are identical for every reviewer.
      // Canvas extraction can be perturbed by browser fingerprinting protection.
      const result = selected.analyses?.[$("threshold").value];
      if (!result)
        throw new Error(
          "This report has no precomputed comparison. Rerun its capture to regenerate the report.",
        );
      if (result.heatFile) {
        const heat = new Image();
        heat.src = `${result.heatFile}${imageVersion}`;
        await heat.decode();
      }
      if (token !== generation) return;
      showAnalysis(result);
    } catch (error) {
      if (token !== generation) return;
      $("pixel-metric").textContent = `Pixel analysis unavailable: ${error.message}`;
    }
  }
  async function load(side, row) {
    if (!row[`${side}Hash`]) return null;
    const image = new Image();
    image.src = `${side}-${row.id}.png${imageVersion}`;
    await image.decode();
    if (image.naturalWidth !== 1440 || image.naturalHeight !== 960)
      throw new Error(`${side} image has unexpected dimensions`);
    return image;
  }
  async function select(row, push = false) {
    selected = row;
    const token = ++generation;
    images = {};
    analysis = null;
    $("view-title").textContent = row.id;
    $("view-description").textContent = `${row.route} · ${row.state}`;
    $("view-status").textContent = row.change;
    for (const [id, button] of buttons) button.setAttribute("aria-current", String(id === row.id));
    $("issues").replaceChildren();
    const issues = [];
    for (const side of ["base", "head"])
      for (const message of [
        ...(row[side]?.errors ?? []),
        ...(row[side]?.missing ?? []).map((cmd) => `Missing fixture: ${cmd}`),
      ])
        issues.push(`${side}: ${message}`);
    $("limitations").hidden = issues.length === 0;
    for (const issue of issues) $("issues").append(text("li", issue));
    $("regions").replaceChildren();
    $("pixel-bounds").textContent = "";
    $("pixel-metric").textContent = "Loading screenshots…";
    stage.replaceChildren(text("p", "Loading screenshots…", "empty-message"));
    urlState(push);
    const loaded = await Promise.allSettled([load("base", row), load("head", row)]);
    if (token !== generation) return;
    for (let index = 0; index < 2; index++) {
      const side = index === 0 ? "base" : "head";
      if (loaded[index].status === "fulfilled") images[side] = loaded[index].value;
      else {
        $("issues").append(text("li", `${side}: ${loaded[index].reason.message}`));
        $("limitations").hidden = false;
      }
    }
    renderStage();
    await analyze(token);
  }
  let pan = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      event.target.closest("button,input,select") ||
      scale <= fitScale() + 0.01
    )
      return;
    pan = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("panning");
    viewport.focus({ preventScroll: true });
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!pan) return;
    viewport.scrollLeft = pan.left - event.clientX + pan.x;
    viewport.scrollTop = pan.top - event.clientY + pan.y;
  });
  const endPan = () => {
    pan = null;
    viewport.classList.remove("panning");
  };
  viewport.addEventListener("pointerup", endPan);
  viewport.addEventListener("pointercancel", endPan);
  viewport.addEventListener("lostpointercapture", endPan);
  window.addEventListener("popstate", () => {
    const next = new URLSearchParams(location.hash.slice(1));
    mode = modes.includes(next.get("mode")) ? next.get("mode") : "side";
    zoom = next.get("zoom") === "100" ? 1 : "fit";
    select(byId.get(next.get("view")) ?? rows[0]);
  });
  filter();
  select(selected);
})();
