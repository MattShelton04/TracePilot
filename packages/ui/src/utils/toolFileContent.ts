/** Recognize the CLI's numbered source envelope without stripping arbitrary source. */
export function normalizeViewedSource(content: string, requestedStart = 1) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  const numbered = lines.map((line) => line.match(/^(\d+)(?:\. |\t|: ?)(.*)$/));
  const first = numbered[0];
  // A single numbered prose line is ambiguous unless the requested range confirms it.
  if (
    first &&
    (lines.length > 1 || Number(first[1]) === requestedStart) &&
    numbered.every((line, index) => line && Number(line[1]) === Number(first[1]) + index)
  ) {
    return {
      code: numbered.map((line) => line?.[2] ?? "").join("\n"),
      startLine: Number(first[1]),
    };
  }
  return { code: content, startLine: requestedStart };
}

export function sourceLineCount(content: string): number {
  if (!content) return 0;
  const lines = content.split(/\r?\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

/** Unnumbered path rows with an explicit directory marker; an extensionless path alone is not evidence. */
export function isDirectoryOutput(content: string): boolean {
  const lines = content.trim().split(/\r?\n/);
  if (!content.trim()) return false;
  if (/^(?:Directory(?: listing)?(?: of)?:|Contents of directory\b)/i.test(lines[0])) return true;
  return (
    lines.some((line) => /[/\\]$/.test(line)) &&
    lines.every((line) => /^[\w.@~ ()\-/\\]+(?:\.[\w.-]+)?[/\\]?$/.test(line))
  );
}
