import { parseArgs } from "node:util";

export const VIEWPORTS = [
  { name: "1440x960", width: 1440, height: 960, full: true },
  { name: "960x640", width: 960, height: 640 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "390x844", width: 390, height: 844, full: true, mobile: true },
  { name: "1440x960-reduced", width: 1440, height: 960, reduce: true },
];

/** Keep local checks complete; CI selects one named viewport per independent job. */
export function checkPlan(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: { viewport: { type: "string", multiple: true } },
  });
  if (!values.viewport) return VIEWPORTS;
  const names = new Set(values.viewport);
  for (const name of names) {
    if (!VIEWPORTS.some((viewport) => viewport.name === name))
      throw new Error(`Unknown site check viewport: ${name}`);
  }
  return VIEWPORTS.filter((viewport) => names.has(viewport.name));
}
