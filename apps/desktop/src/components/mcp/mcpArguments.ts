/** One process argument per line; commas and spaces within a line are literal. */
export function parseMcpArguments(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The line editor cannot represent empty arguments, edge whitespace or embedded newlines. */
export function canEditMcpArguments(args: string[]): boolean {
  // Textareas normalize bare carriage returns as well as CRLF to newlines.
  if (args.some((argument) => /[\r\n]/.test(argument))) return false;
  const parsed = parseMcpArguments(args.join("\n"));
  return (
    parsed.length === args.length && parsed.every((argument, index) => argument === args[index])
  );
}
