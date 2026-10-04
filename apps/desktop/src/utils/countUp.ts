/**
 * Count displayed numbers up from zero to their already-formatted value.
 *
 * Works on rendered text so any formatter's output (`8,354.25`, `8699.7M`,
 * `$0.06`, `93.2%`) keeps its prefix, suffix, decimals and grouping. Text
 * with more than one number (durations such as `1h 17m`) is left alone.
 * Every element ends on exactly the text it started with.
 */

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

export interface CountableText {
  prefix: string;
  value: number;
  decimals: number;
  grouped: boolean;
  suffix: string;
}

export function parseCountable(text: string): CountableText | null {
  const matches = text.match(NUMBER);
  if (matches?.length !== 1) return null;
  const raw = matches[0];
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value === 0) return null;
  const start = text.indexOf(raw);
  return {
    prefix: text.slice(0, start),
    value,
    decimals: raw.split(".")[1]?.length ?? 0,
    grouped: raw.includes(","),
    suffix: text.slice(start + raw.length),
  };
}

export function formatCountable(parsed: CountableText, value: number): string {
  const number = value.toLocaleString("en-US", {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
    useGrouping: parsed.grouped,
  });
  return parsed.prefix + number + parsed.suffix;
}

interface Counter {
  node: Text;
  finalText: string;
  parsed: CountableText;
  written: string;
}

function findCounter(el: Element): Counter | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let found: Counter | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    if (!/\d/.test(text)) continue;
    const parsed = parseCountable(text);
    // Several numeric text nodes are ambiguous; leave the element as is.
    if (!parsed || found) return null;
    found = { node: node as Text, finalText: text, parsed, written: text };
  }
  return found;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Start counting; returns a function that jumps every element to its end. */
export function countUp(elements: Iterable<Element>, durationMs: number): () => void {
  const counters: Counter[] = [];
  for (const el of elements) {
    const counter = findCounter(el);
    if (counter) counters.push(counter);
  }
  if (counters.length === 0) return () => {};

  let frame = 0;
  const start = performance.now();
  const write = (progress: number) => {
    for (const c of counters) {
      // Vue re-rendered this value (new data): it owns the text again.
      if (c.node.nodeValue !== c.written) continue;
      c.written =
        progress >= 1
          ? c.finalText
          : formatCountable(c.parsed, c.parsed.value * easeOutCubic(progress));
      c.node.nodeValue = c.written;
    }
  };
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / durationMs);
    write(progress);
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  write(0);
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    write(1);
  };
}
