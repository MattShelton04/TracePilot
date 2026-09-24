// Chromium re-rasterizes only invalidated tiles by default, so blurred shadows
// (for example the sidebar brand glow) could differ by 1/255 between fresh
// contexts. Measured locally: 14 of 56 repeated pairs differed without these
// flags, 0 of 56 with them. Skia's CPU-specific SIMD paths are also disabled
// because hosted runners do not share one CPU model.
export const chromiumArgs = [
  "--disable-partial-raster",
  "--disable-skia-runtime-opts",
  "--force-color-profile=srgb",
];
/** Missing historical views are comparison limitations, not head regressions. */
export function captureExitCode(reports, revision = "head") {
  if (revision !== "base" && revision !== "head") {
    throw new Error(`Invalid visual revision: ${revision}`);
  }
  // A few new routes can be unavailable; a completely broken baseline is a failure.
  if (revision === "base") return reports.some((item) => item.status === "captured") ? 0 : 1;
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
