/** Missing historical views are comparison limitations, not head regressions. */
export function captureExitCode(reports, revision = "head") {
  if (revision !== "base" && revision !== "head") {
    throw new Error(`Invalid visual revision: ${revision}`);
  }
  if (revision === "base") return 0;
  return reports.length > 0 && reports.every((item) => item.status === "captured") ? 0 : 1;
}
// The first paint can differ from subsequent rasterized frames even after fonts
// and layout settle. Require a matching pair, without pixel tolerances or masks.
export async function stableScreenshot(capture, limit = 5) {
  let previous;
  for (let attempts = 1; attempts <= limit; attempts++) {
    const png = await capture();
    if (previous?.equals(png)) return { png, attempts };
    previous = png;
  }
  throw new Error(`Screenshot did not stabilize within ${limit} captures`);
}
