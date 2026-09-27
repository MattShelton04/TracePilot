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
    !/^(?:error|warning|note|search|found|total)[: ]/i.test(line) &&
    !isNoSearchResults(line) &&
    !line.includes("…[truncated]") &&
    (!/\s/.test(line) || /[/\\]/.test(line))
  );
}

/** Parse known CLI rows; unrecognized output stays visible instead of becoming a fake filename. */
export function parseSearchResults(content: string, mode: string) {
  const matches: SearchMatch[] = [];
  const notices: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line === "--" || isNoSearchResults(line)) continue;
    if (/^(?:error|warning|note|search|found|total)[: ]/i.test(line)) {
      notices.push(line);
      continue;
    }
    if (mode === "files_with_matches") {
      if (isPathRow(line)) matches.push({ file: line.trim(), text: "" });
      else notices.push(line);
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
  const normalized = [
    ...new Set(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  const notices = normalized.filter((line) => !isPathRow(line) && !isNoSearchResults(line));
  const files = normalized.filter(isPathRow).map((line) => line.replace(/\\/g, "/"));
  const root = searchRoot?.replace(/\\/g, "/").replace(/\/+$/, "");
  const windowsRoot = root && /^[A-Za-z]:/.test(root);
  const paths = [...new Set(files)].map((file) => {
    if (!root) return file;
    const comparedFile = windowsRoot ? file.toLowerCase() : file;
    const comparedRoot = windowsRoot ? root.toLowerCase() : root;
    return comparedFile.startsWith(`${comparedRoot}/`) ? file.slice(root.length + 1) : file;
  });
  return { paths, notices };
}
