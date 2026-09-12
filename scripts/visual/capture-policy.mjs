/** Missing historical views are comparison limitations, not head regressions. */
export function captureExitCode(reports, revision = "head") {
  if (revision !== "base" && revision !== "head") {
    throw new Error(`Invalid visual revision: ${revision}`);
  }
  if (revision === "base") return 0;
  return reports.length > 0 && reports.every((item) => item.status === "captured") ? 0 : 1;
}
