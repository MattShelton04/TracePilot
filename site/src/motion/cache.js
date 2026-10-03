import { $, $$ } from "./env.js";

/* ---------- cache countdown (real time) ---------- */
export const cache = (() => {
  const total = 3 * 60 + 45;
  let t0 = 0,
    timer = 0;
  const paint = (left) => {
    const s = Math.max(0, Math.ceil(left));
    const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    $$(".app .cache-time").forEach((e) => {
      e.textContent = txt;
    });
    $$(".app .cache-chip").forEach((c) => {
      c.classList.toggle("is-cold", s === 0);
      const l = $(".cache-label", c);
      if (l) l.textContent = s === 0 ? "Cache expired" : "Cache expiring";
    });
  };
  return {
    start() {
      if (timer) return;
      t0 = performance.now();
      timer = setInterval(() => paint(total - (performance.now() - t0) / 1000), 250);
    },
    reset() {
      if (!timer) return;
      clearInterval(timer);
      timer = 0;
      paint(total);
    },
  };
})();
