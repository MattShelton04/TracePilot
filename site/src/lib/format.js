// Number and date formatting shared by the scroll scenes, the replica and the bento.

export const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
export const fmtAic = (n) => `${n.toFixed(1)} AIC`;
export const fmtUsd = (n) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** 0.083 -> "8.3%", 0.16 -> "16%" */
export const fmtPct = (f) => {
  const p = f * 100;
  return `${p >= 10 ? Math.round(p) : p.toFixed(1)}%`;
};
/** Tool-call latency as the app shows it: "900ms", "1.4s". */
export const lat = (ms) => (ms >= 1000 ? `${+(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
/** "4f1c2a9e-…-0c2f8d5e3b71" -> "4f1c2a9e…d5e3b71" */
export const shortId = (id) => `${id.slice(0, 8)}…${id.slice(-7)}`;
/** "30/09/2026, 1:31:48 pm" in UTC, matching the app's session info panel. */
export function dateTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  const h = d.getUTCHours();
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${h % 12 || 12}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${h >= 12 ? "pm" : "am"}`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
/** How long ago an ISO date was: "today", "yesterday", "8 days ago", "3 weeks ago", "2 months ago". */
export function ago(iso, now = Date.now()) {
  const days = Math.min(0, Math.round((Date.parse(iso) - now) / 864e5));
  if (days > -14) return relative.format(days, "day");
  if (days > -60) return relative.format(Math.round(days / 7), "week");
  return relative.format(Math.round(days / 30.44), "month");
}
