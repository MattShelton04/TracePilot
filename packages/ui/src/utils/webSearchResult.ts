export interface WebSearchBody {
  text: string;
  structured: boolean;
  recognized: boolean;
}

/** Known Copilot/MCP text envelopes; unknown fields remain in the raw response. */
function textParts(value: unknown, depth = 0): string[] {
  if (depth > 12) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((part) => textParts(part, depth + 1));
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if ("text" in object) return textParts(object.text, depth + 1);
    if ("value" in object) return textParts(object.value, depth + 1);
    if ("content" in object) return textParts(object.content, depth + 1);
  }
  return [];
}

export function parseWebSearchBody(content: string): WebSearchBody {
  try {
    const value: unknown = JSON.parse(content);
    const parts = textParts(value);
    return {
      text: parts.length ? parts.join("\n\n") : content,
      structured: true,
      recognized: parts.length > 0,
    };
  } catch {
    return { text: content, structured: false, recognized: true };
  }
}

export interface WebSearchSource {
  title: string;
  url: string;
  domain: string;
}

/** Consume the same sanitized Markdown links as the body, including balanced URLs. */
export function webSearchSources(sanitizedHtml: string): WebSearchSource[] {
  const document = new DOMParser().parseFromString(sanitizedHtml, "text/html");
  const seen = new Set<string>();
  const sources: WebSearchSource[] = [];
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = link.getAttribute("href");
    if (!href || seen.has(href)) continue;
    try {
      const url = new URL(href);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      seen.add(href);
      sources.push({
        title: link.textContent?.trim() || url.hostname,
        url: href,
        domain: url.hostname.replace(/^www\./, ""),
      });
    } catch {
      /* Relative or malformed links are not external sources. */
    }
  }
  return sources;
}
