export interface SearchMatch {
  file: string;
  lineNum?: number;
  text: string;
  isContext?: boolean;
}

export function isNoSearchResults(line: string): boolean {
  return /^(?:no (?:matches|files|results)(?: (?:found|matched))?|0 (?:matches|files|results))(?:[.!]|\s*)$/i.test(
    line.trim(),
  );
}

export function isPathRow(line: string): boolean {
  return (
    !!line.trim() &&
    !isSearchEnvelopeNotice(line) &&
    !/^(?:error|warning|note|search|found|total)[: ]/i.test(line) &&
    !isNoSearchResults(line) &&
    !line.includes("…[truncated]") &&
    (!/\s/.test(line) || /[/\\]/.test(line))
  );
}

function isSearchEnvelopeNotice(line: string): boolean {
  // CLI search scope metadata may contain paths; it is not a matching file.
  return /^\[.*\]$/.test(line.trim()) && /[\s:/\\]/.test(line);
}

/** Parse known CLI rows; unrecognized output stays visible instead of becoming a fake filename. */
export function parseSearchResults(content: string, mode: string) {
  const matches: SearchMatch[] = [];
  const notices: string[] = [];
  const lines = content.split(/\r?\n/);
  let groupedFile: string | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || line === "--" || isNoSearchResults(line)) continue;
    if (
      isSearchEnvelopeNotice(line) ||
      /^(?:error|warning|note|search|found|total)[: ]/i.test(line)
    ) {
      notices.push(line);
      continue;
    }
    if (mode === "files_with_matches") {
      if (isPathRow(line)) matches.push({ file: line.trim(), text: "" });
      else notices.push(line);
      continue;
    }
    // Current CLI content output groups indented `N:text` rows under
    // `file.ts (3 match(es)):`. Require the following numbered row so arbitrary
    // prose ending with a colon remains a notice.
    const heading = line.match(/^(.+?)(?:\s+\(\d+\s+match(?:es|\(es\))?\))?:\s*$/i);
    const next = lines[index + 1] ?? "";
    if (heading && /^\s+\d+[:-]/.test(next)) {
      groupedFile = heading[1].trim();
      continue;
    }
    const grouped = groupedFile ? line.match(/^\s+(\d+)([:-])(.*)$/) : null;
    if (grouped && groupedFile) {
      matches.push({
        file: groupedFile,
        lineNum: Number(grouped[1]),
        text: grouped[3],
        isContext: grouped[2] === "-",
      });
      continue;
    }
    if (mode === "count") {
      const count = line.match(/^(.+):(\d+)$/);
      if (count) matches.push({ file: count[1], text: count[2] });
      else notices.push(line);
      continue;
    }
    const numbered = line.match(/^(.+?):(\d+):(.*)$/);
    const context = line.match(/^(.+?)-(\d+)-(.*)$/);
    const numberedRow = numbered ?? context;
    if (numberedRow) {
      matches.push({
        file: numberedRow[1],
        lineNum: Number(numberedRow[2]),
        text: numberedRow[3],
        isContext: !numbered,
      });
      continue;
    }
    const bare = line.match(/^([A-Za-z]:[\\/].+?):(.*)$/) ?? line.match(/^([^:]+):(.*)$/);
    if (bare && isPathRow(bare[1])) matches.push({ file: bare[1], text: bare[2] });
    else notices.push(line);
  }
  return { matches, notices };
}

export function normalizeGlobPaths(content: string, searchRoot?: string | null) {
  const lines = content.split(/\r?\n/);
  const notices: string[] = [];
  const files: string[] = [];
  let directory: string | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || isNoSearchResults(trimmed)) continue;
    const groupedPath = directory && /^\s{2,}\S/.test(line) && !isSearchEnvelopeNotice(trimmed);
    if (!isPathRow(trimmed) && !groupedPath) {
      notices.push(trimmed);
      continue;
    }
    const path = trimmed.replace(/\\/g, "/");
    const absolute = /^(?:[A-Za-z]:\/|\/)/.test(path);
    // Current CLI glob output lists an absolute directory, then its indented
    // relative results. Keep that scope instead of counting the heading as a file.
    if (absolute && /^\s{2,}\S/.test(lines[index + 1] ?? "")) {
      directory = path.replace(/\/$/, "");
      continue;
    }
    files.push(directory && /^\s{2,}\S/.test(line) && !absolute ? `${directory}/${path}` : path);
    if (!/^\s/.test(line)) directory = undefined;
  }
  const root = searchRoot?.replace(/\\/g, "/").replace(/\/+$/, "");
  const windowsRoot = root && /^[A-Za-z]:/.test(root);
  const paths = [...new Set(files)].map((file) => {
    if (!root) return file;
    const comparedFile = windowsRoot ? file.toLowerCase() : file;
    const comparedRoot = windowsRoot ? root.toLowerCase() : root;
    return comparedFile.startsWith(`${comparedRoot}/`) ? file.slice(root.length + 1) : file;
  });
  return { paths, notices: [...new Set(notices)] };
}
