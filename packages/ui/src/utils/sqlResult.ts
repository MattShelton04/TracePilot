export type SqlCellKind = "text" | "number" | "boolean" | "null" | "empty" | "missing" | "json";

export interface SqlCell {
  text: string;
  kind: SqlCellKind;
}

export interface SqlTable {
  headers: string[];
  rows: SqlCell[][];
  /** Text outside a parsed table must remain visible. */
  before?: string;
  after?: string;
}

function cell(value: unknown, present = true): SqlCell {
  if (!present) return { text: "—", kind: "missing" };
  if (value === null) return { text: "NULL", kind: "null" };
  if (value === "") return { text: '""', kind: "empty" };
  if (typeof value === "number") return { text: String(value), kind: "number" };
  if (typeof value === "boolean") return { text: String(value), kind: "boolean" };
  if (typeof value === "object") return { text: JSON.stringify(value), kind: "json" };
  return { text: String(value), kind: "text" };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fromRows(values: unknown[]): SqlTable {
  if (values.length === 0) return { headers: [], rows: [] };
  if (values.every(Array.isArray)) {
    const width = values.reduce((max, row) => Math.max(max, row.length), 0);
    return {
      headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`),
      rows: values.map((row) => Array.from({ length: width }, (_, i) => cell(row[i], i in row))),
    };
  }
  const keys = [...new Set(values.flatMap((value) => (record(value) ? Object.keys(value) : [])))];
  const hasScalar = values.some((value) => !record(value));
  return {
    headers: [...keys, ...(hasScalar ? ["Value"] : [])],
    rows: values.map((value) => [
      ...keys.map((key) =>
        cell(record(value) ? value[key] : undefined, record(value) && Object.hasOwn(value, key)),
      ),
      ...(hasScalar ? [cell(value, !record(value))] : []),
    ]),
  };
}

function fromJson(value: unknown): SqlTable | null {
  if (Array.isArray(value)) return fromRows(value);
  if (record(value)) {
    for (const key of ["rows", "data", "results"]) {
      if (Array.isArray(value[key])) {
        const metadata = Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
        return {
          ...fromRows(value[key]),
          after: Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : undefined,
        };
      }
    }
  }
  return null;
}

/** Split Markdown table delimiters without splitting escaped pipes or code spans. */
function pipeRow(line: string): string[] {
  const text = line.trim();
  const parts: string[] = [];
  let value = "";
  let codeTicks = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\" && text[i + 1] === "|") {
      value += "|";
      i++;
    } else if (char === "`") {
      let ticks = 1;
      while (text[i + ticks] === "`") ticks++;
      if (codeTicks === 0) codeTicks = ticks;
      else if (codeTicks === ticks) codeTicks = 0;
      value += "`".repeat(ticks);
      i += ticks - 1;
    } else if (char === "|" && codeTicks === 0) {
      parts.push(value.trim());
      value = "";
    } else value += char;
  }
  parts.push(value.trim());
  if (text.startsWith("|")) parts.shift();
  if (text.endsWith("|") && !text.endsWith("\\|")) parts.pop();
  return parts;
}

function markdownCell(text: string): SqlCell {
  if (/^null$/i.test(text)) return cell(null);
  if (/^(?:true|false)$/.test(text)) return cell(text === "true");
  // Keep the original text: converting to Number can round database integers.
  if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return { text, kind: "number" };
  return cell(text);
}

function markdownTable(content: string): SqlTable | null {
  const lines = content.split(/\r?\n/);
  for (let separator = 1; separator < lines.length; separator++) {
    if (!lines[separator].includes("|")) continue;
    const separators = pipeRow(lines[separator]);
    if (!separators.length || !separators.every((part) => /^:?-{2,}:?$/.test(part))) continue;
    const headers = pipeRow(lines[separator - 1]);
    if (headers.length !== separators.length) continue;
    const rows: SqlCell[][] = [];
    let end = separator + 1;
    for (; end < lines.length; end++) {
      if (!lines[end].trim() || !lines[end].includes("|")) break;
      const values = pipeRow(lines[end]);
      // A malformed/mixed result remains visible in the trailing raw text.
      if (values.length !== headers.length) break;
      rows.push(values.map(markdownCell));
    }
    return {
      headers,
      rows,
      before: lines
        .slice(0, separator - 1)
        .join("\n")
        .trim(),
      after: lines.slice(end).join("\n").trim(),
    };
  }
  return null;
}

/** Find a JSON array embedded in a textual response without a lossy regex. */
function embeddedArray(content: string): SqlTable | null {
  const start = content.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) {
      try {
        const table = fromJson(JSON.parse(content.slice(start, i + 1)));
        if (table)
          return {
            ...table,
            before: content.slice(0, start).trim(),
            after: content.slice(i + 1).trim(),
          };
      } catch {
        /* Keep an unrecognized response as plain text. */
      }
      return null;
    }
  }
  return null;
}

export function parseSqlResult(content: string): SqlTable | null {
  const text = content.trim();
  if (!text) return null;
  try {
    return fromJson(JSON.parse(text));
  } catch {
    /* Try the known text formats below. */
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 1) {
    try {
      const values: unknown[] = lines.map((line) => JSON.parse(line));
      if (values.every(record)) return fromRows(values);
    } catch {
      /* Not a complete NDJSON result. */
    }
  }
  return markdownTable(content) ?? embeddedArray(content);
}
