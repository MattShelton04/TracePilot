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
  /** Where counting starts; zero unless counting from a previous value. */
  from?: number;
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
  return animate(counters, durationMs);
}

/** The text of an element's one countable number, or null. */
export function countableText(el: Element): string | null {
  return findCounter(el)?.finalText ?? null;
}

/**
 * Count each element from the number it showed before (as read by
 * `countableText`) to the one it shows now. Only numbers whose prefix,
 * suffix and decimals are unchanged count; a change of unit (`512M` to
 * `1.2B`) or format just shows the new text.
 */
export function countFrom(previous: Map<Element, string>, durationMs: number): () => void {
  const counters: Counter[] = [];
  for (const [el, before] of previous) {
    if (!el.isConnected) continue;
    const counter = findCounter(el);
    const raw = before.match(NUMBER);
    if (!counter || raw?.length !== 1 || before === counter.finalText) continue;
    const { parsed } = counter;
    const start = before.indexOf(raw[0]);
    const decimals = raw[0].split(".")[1]?.length ?? 0;
    if (
      before.slice(0, start) !== parsed.prefix ||
      before.slice(start + raw[0].length) !== parsed.suffix ||
      decimals !== parsed.decimals
    ) {
      continue;
    }
    counter.from = Number(raw[0].replace(/,/g, ""));
    counters.push(counter);
  }
  return animate(counters, durationMs);
}

function animate(counters: Counter[], durationMs: number): () => void {
  if (counters.length === 0) return () => {};

  let frame = 0;
  const start = performance.now();
  const write = (progress: number) => {
    for (const c of counters) {
      // Vue re-rendered this value (new data): it owns the text again.
      if (c.node.nodeValue !== c.written) continue;
      const from = c.from ?? 0;
      c.written =
        progress >= 1
          ? c.finalText
          : formatCountable(c.parsed, from + (c.parsed.value - from) * easeOutCubic(progress));
      c.node.nodeValue = c.written;
    }
  };
  const tick = (now: number) => {
    // A frame timestamp can predate `start` when it was taken mid-render.
    const progress = Math.min(1, Math.max(0, (now - start) / durationMs));
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
