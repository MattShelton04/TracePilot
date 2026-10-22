/**
 * Pretty-printing for tool results that are a JSON object or array, such as
 * MCP tool output with no dedicated renderer.
 */

/** Results longer than this many characters stay as plain text. */
export const MAX_JSON_RESULT_CHARS = 256 * 1024;

/**
 * Re-indents `content` with two spaces when, trimmed, it is a complete JSON
 * object or array. Returns null for anything else: plain text, scalars,
 * invalid or truncated JSON, and content above {@link MAX_JSON_RESULT_CHARS}.
 *
 * Only whitespace between tokens changes. Strings and numbers keep their
 * source spelling, so large integers, escapes and duplicate keys survive.
 */
export function formatJsonResult(content: string): string | null {
  if (content.length > MAX_JSON_RESULT_CHARS) return null;
  const text = content.trim();
  const first = text[0];
  const last = text[text.length - 1];
  if (!((first === "{" && last === "}") || (first === "[" && last === "]"))) return null;
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  return reindent(text);
}

/** Re-indents text already known to be valid JSON. */
function reindent(text: string): string {
  let out = "";
  let depth = 0;
  let inString = false;
  const newline = () => `\n${"  ".repeat(depth)}`;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i];
      else if (ch === '"') inString = false;
      continue;
    }
    switch (ch) {
      case " ":
      case "\t":
      case "\n":
      case "\r":
        break;
      case '"':
        inString = true;
        out += ch;
        break;
      case "{":
      case "[": {
        const close = ch === "{" ? "}" : "]";
        let next = i + 1;
        while (/\s/.test(text[next] ?? "")) next++;
        if (text[next] === close) {
          out += ch + close;
          i = next;
        } else {
          depth++;
          out += ch + newline();
        }
        break;
      }
      case "}":
      case "]":
        depth--;
        out += newline() + ch;
        break;
      case ",":
        out += `,${newline()}`;
        break;
      case ":":
        out += ": ";
        break;
      default:
        out += ch;
    }
  }
  return out;
}
