/** Compare compatible native desktop runs. Small samples describe medians, never p95. */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(values) {
  return {
    n: values.length,
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function compare(base, head) {
  if (base.status !== "complete" || head.status !== "complete") {
    return {
      status: "execution failure",
      reason: "Both runs must complete successfully",
      rows: [],
    };
  }
  const dimensions = [
    "harnessVersion",
    "fixtureVersion",
    "fixtureHash",
    "platform",
    "node",
    "viewport",
    "cpuThrottleRate",
  ];
  for (const key of dimensions) {
    if (base[key] === undefined || JSON.stringify(base[key]) !== JSON.stringify(head[key])) {
      return {
        status: "unavailable/incompatible",
        reason: `Different or missing ${key}`,
        rows: [],
      };
    }
  }
  for (const key of ["product", "revision"]) {
    if (!base.webview?.[key] || base.webview[key] !== head.webview?.[key]) {
      return {
        status: "unavailable/incompatible",
        reason: `Different or missing WebView ${key}`,
        rows: [],
      };
    }
  }
  for (const key of ["frontend", "rustProfile", "automationDevtools"]) {
    if (
      base.launch?.build?.[key] === undefined ||
      base.launch.build[key] !== head.launch?.build?.[key]
    ) {
      return {
        status: "unavailable/incompatible",
        reason: `Different build mode ${key}`,
        rows: [],
      };
    }
  }
  for (const key of ["id", "turnCount"]) {
    if (
      base.selectedSession?.[key] === undefined ||
      base.selectedSession[key] !== head.selectedSession?.[key]
    ) {
      return {
        status: "unavailable/incompatible",
        reason: `Different or missing selected session ${key}`,
        rows: [],
      };
    }
  }
  const names = ["session-list", "conversation", "analytics", "search"];
  // Added in later harness runs; compared only when both runs measured it.
  const optionalNames = ["conversation-scroll"];
  const values = (run, name) =>
    run.samples.filter((s) => s.name === name && s.iteration > 0).map((s) => s.durationMs);
  const measuredOptional = optionalNames.filter(
    (name) => values(base, name).length > 0 && values(head, name).length > 0,
  );
  const rows = [...names, ...measuredOptional].map((name) => {
    const a = values(base, name);
    const b = values(head, name);
    if (a.length < 3 || b.length < 3 || [...a, ...b].some((v) => !Number.isFinite(v) || v <= 0)) {
      return {
        name,
        status: "missing result",
        reason: "Need at least three valid warm operation samples per run",
      };
    }
    const before = summarize(a);
    const after = summarize(b);
    const changeMs = after.median - before.median;
    const changePercent = (100 * changeMs) / before.median;
    // Conservative descriptive screening, not a statistical significance test.
    // Overlapping observed ranges remain inconclusive outside the measured ~10% noise band.
    const status =
      Math.abs(changePercent) <= 10
        ? "effectively unchanged"
        : after.max < before.min
          ? "improvement"
          : after.min > before.max
            ? "regression"
            : "inconclusive";
    return { name, status, before, after, changeMs, changePercent };
  });
  return {
    status: rows.some((row) => row.status === "missing result") ? "missing result" : "compared",
    methodology:
      "Warm iterations only; median and full observed range. 10% screening band based on local A/A runs; no percentile or statistical significance claim. Independently verify same machine and cache policy.",
    binaries: [base.launch.build.executableSha256, head.launch.build.executableSha256],
    rows,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [basePath, headPath, output] = process.argv.slice(2);
  if (!basePath || !headPath || !output)
    throw new Error(
      "Usage: node scripts/perf/compare.mjs BASE/desktop.json HEAD/desktop.json REPORT.md",
    );
  const result = compare(JSON.parse(readFileSync(basePath)), JSON.parse(readFileSync(headPath)));
  const lines = [
    "# Native desktop performance comparison",
    "",
    `Status: **${result.status}**.`,
    "",
    result.reason ?? result.methodology,
    "",
  ];
  if (result.rows.length) {
    lines.push(
      "| Operation | Status | Base median [range], ms | Head median [range], ms | Change | n (base/head) |",
      "| --- | --- | ---: | ---: | ---: | ---: |",
    );
    const format = (s) => `${s.median.toFixed(1)} [${s.min.toFixed(1)}–${s.max.toFixed(1)}]`;
    for (const row of result.rows)
      lines.push(
        row.before
          ? `| ${row.name} | ${row.status} | ${format(row.before)} | ${format(row.after)} | ${row.changeMs.toFixed(1)} ms (${row.changePercent.toFixed(1)}%) | ${row.before.n}/${row.after.n} |`
          : `| ${row.name} | ${row.status} | — | — | — | — |`,
      );
    lines.push(
      "",
      "Binary SHA-256 (base, head):",
      "",
      ...result.binaries.map((hash) => `- ${hash}`),
    );
  }
  writeFileSync(output, `${lines.join("\n")}\n`);
  writeFileSync(`${output}.json`, JSON.stringify(result, null, 2));
  console.log(lines.join("\n"));
  if (["execution failure", "missing result", "unavailable/incompatible"].includes(result.status))
    process.exitCode = 1;
}
