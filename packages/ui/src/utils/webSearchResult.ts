export interface WebSearchBody {
  text: string;
  structured: boolean;
  recognized: boolean;
  citations: WebSearchSource[];
}

/** Known Copilot/MCP text envelopes; unknown fields remain in the raw response. */
function textParts(value: unknown, citations: WebSearchSource[], depth = 0): string[] {
  if (depth > 12) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((part) => textParts(part, citations, depth + 1));
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.annotations)) {
      for (const annotation of object.annotations) {
        const citation = annotation?.url_citation;
        if (!citation || typeof citation !== "object") continue;
        const source = externalSource(citation.url, citation.title);
        if (source) citations.push(source);
      }
    }
    if ("text" in object) return textParts(object.text, citations, depth + 1);
    if ("value" in object) return textParts(object.value, citations, depth + 1);
    if ("content" in object) return textParts(object.content, citations, depth + 1);
  }
  return [];
}

export function parseWebSearchBody(content: string): WebSearchBody {
  try {
    const value: unknown = JSON.parse(content);
    const citations: WebSearchSource[] = [];
    const parts = textParts(value, citations);
    return {
      text: parts.length ? parts.join("\n\n") : content,
      structured: true,
      recognized: parts.length > 0,
      citations,
    };
  } catch {
    return { text: content, structured: false, recognized: true, citations: [] };
  }
}

export interface WebSearchSource {
  title: string;
  url: string;
  domain: string;
}

function externalSource(href: unknown, title: unknown): WebSearchSource | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      title: typeof title === "string" && title.trim() ? title.trim() : url.hostname,
      url: url.href,
      domain: url.hostname.replace(/^www\./, ""),
    };
  } catch {
    return null;
  }
}

/** Consume the same sanitized Markdown links as the body, including balanced URLs. */
export function webSearchSources(
  sanitizedHtml: string,
  citations: WebSearchSource[] = [],
): WebSearchSource[] {
  const document = new DOMParser().parseFromString(sanitizedHtml, "text/html");
  const seen = new Set<string>();
  const sources: WebSearchSource[] = [];
  const add = (href: unknown, title: unknown) => {
    const source = externalSource(href, title);
    if (!source || seen.has(source.url)) return;
    seen.add(source.url);
    sources.push(source);
  };
  // Annotation offsets describe the exact original text. Use the citation
  // metadata as source cards without rewriting Markdown or moving its indices.
  for (const citation of citations) add(citation.url, citation.title);
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    add(link.getAttribute("href"), link.textContent);
  }
  return sources;
}
