import type { SkillFrontmatter } from "@tracepilot/types";

export type SkillFrontmatterStatus = "parsed" | "missing" | "malformed";

export interface ParsedSkillContent {
  frontmatter: SkillFrontmatter | null;
  body: string;
  status: SkillFrontmatterStatus;
}

export function parseSkillContent(content: string): ParsedSkillContent {
  const trimmed = content.replace(/^\uFEFF/, "").trimStart();
  const fmMatch = trimmed.match(
    /^---(?:\r\n|\r|\n)([\s\S]*?)(?:\r\n|\r|\n)---(?:\r\n|\r|\n)?([\s\S]*)$/,
  );

  if (!fmMatch) {
    return {
      frontmatter: null,
      body: content,
      status: trimmed.startsWith("---") ? "malformed" : "missing",
    };
  }

  const fmBlock = fmMatch[1];
  const frontmatter: SkillFrontmatter = { name: "", description: "" };
  let currentKey = "";
  let multilineValue = "";
  let inMultiline = false;
  let inGlobs = false;
  let inAllowedTools = false;

  const lines = fmBlock.split(/\r\n|\r|\n/);
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const kv = line.match(/^([\w][\w._-]*):\s*(.*)$/);

    if (kv) {
      if (inMultiline && currentKey) {
        assignKnownFrontmatterKey(frontmatter, currentKey, multilineValue.trim());
        inMultiline = false;
        multilineValue = "";
      }

      inGlobs = false;
      inAllowedTools = false;
      currentKey = kv[1].trim();
      const value = kv[2].trim();

      if (value === ">" || value === "|" || value === ">-" || value === "|-") {
        inMultiline = true;
        multilineValue = "";
      } else {
        const unquoted = yamlUnescapeScalar(value);
        if (currentKey === "resource_globs") {
          inGlobs = true;
          frontmatter.resource_globs = [];
        } else if (currentKey === "allowed-tools" && value === "") {
          inAllowedTools = true;
          frontmatter["allowed-tools"] = [];
        } else {
          assignKnownFrontmatterKey(frontmatter, currentKey, unquoted);
        }
      }
      continue;
    }

    if (inMultiline && (line.startsWith("  ") || line === "")) {
      multilineValue += (multilineValue ? " " : "") + line.trim();
      continue;
    }

    if (line.match(/^\s+-\s+/) && inGlobs) {
      const glob = line.replace(/^\s+-\s+/, "").trim();
      if (!frontmatter.resource_globs) frontmatter.resource_globs = [];
      frontmatter.resource_globs.push(yamlUnescapeScalar(glob));
      continue;
    }

    if (line.match(/^\s+-\s+/) && inAllowedTools) {
      const tool = yamlUnescapeScalar(line.replace(/^\s+-\s+/, "").trim());
      const tools = frontmatter["allowed-tools"];
      if (Array.isArray(tools)) tools.push(tool);
      continue;
    }

    if (inMultiline && currentKey) {
      assignKnownFrontmatterKey(frontmatter, currentKey, multilineValue.trim());
      inMultiline = false;
      multilineValue = "";
    }
    inGlobs = false;
    inAllowedTools = false;
  }

  if (inMultiline && currentKey) {
    assignKnownFrontmatterKey(frontmatter, currentKey, multilineValue.trim());
  }

  return {
    frontmatter,
    body: fmMatch[2],
    status: "parsed",
  };
}

export function serializeSkillContent(frontmatter: SkillFrontmatter | null, body: string): string {
  if (!frontmatter) return body;

  let content = "---\n";
  content += `name: ${yamlEscapeScalar(frontmatter.name)}\n`;
  content += `description: ${yamlEscapeScalar(frontmatter.description)}\n`;
  appendOptionalScalar("argument-hint", frontmatter["argument-hint"]);
  const allowedTools = frontmatter["allowed-tools"];
  if (Array.isArray(allowedTools) && allowedTools.length > 0) {
    content += "allowed-tools:\n";
    for (const tool of allowedTools) content += `  - ${yamlEscapeScalar(tool)}\n`;
  } else if (typeof allowedTools === "string") {
    appendOptionalScalar("allowed-tools", allowedTools);
  }
  if (frontmatter["user-invocable"] === false) content += "user-invocable: false\n";
  if (frontmatter["disable-model-invocation"] === true) {
    content += "disable-model-invocation: true\n";
  }
  if (frontmatter.auto_attach) content += "auto_attach: true\n";
  if (frontmatter.resource_globs && frontmatter.resource_globs.length > 0) {
    content += "resource_globs:\n";
    for (const glob of frontmatter.resource_globs) {
      content += `  - ${yamlEscapeScalar(glob)}\n`;
    }
  }
  content += "---\n";
  content += body;
  return content;

  function appendOptionalScalar(key: string, value: string | undefined) {
    if (value !== undefined && value !== "") content += `${key}: ${yamlEscapeScalar(value)}\n`;
  }
}

/** Replace selected top-level fields without reserializing unrelated YAML. */
export function patchSkillFrontmatter(
  content: string,
  changes: Partial<Record<keyof SkillFrontmatter, string | boolean | string[] | undefined>>,
): string {
  const parts = locateFrontmatter(content);
  if (!parts) return content;

  const newline = parts.yaml.includes("\r\n") ? "\r\n" : "\n";
  const lines = parts.yaml.split(/\r\n|\r|\n/);

  for (const [key, value] of Object.entries(changes)) {
    const start = lines.findIndex((line) => new RegExp(`^${escapeRegExp(key)}\\s*:`).test(line));
    let end = start;
    if (start >= 0) {
      end = start + 1;
      const scalar = lines[start].replace(/^[^:]+:\s*/, "").trim();
      const hasIndentedValue = scalar === "" || /^[>|][+-]?$/.test(scalar);
      if (hasIndentedValue) {
        while (end < lines.length && (/^\s+/.test(lines[end]) || lines[end] === "")) end++;
      }
    }

    const replacement = serializeField(key, value, newline);
    if (start >= 0) lines.splice(start, end - start, ...replacement);
    else if (replacement.length > 0) lines.push(...replacement);
  }

  return `${parts.prefix}---${parts.openingNewline}${lines.join(newline)}${parts.closingPrefix}---${parts.after}`;
}

/** Replace only the markdown body, retaining delimiters, whitespace and YAML verbatim. */
export function replaceSkillBody(content: string, body: string): string {
  const parts = locateFrontmatter(content);
  if (!parts) return body;
  const after = parts.after.match(/^(?:\r\n|\r|\n)/)?.[0] ?? "\n";
  return `${parts.prefix}---${parts.openingNewline}${parts.yaml}${parts.closingPrefix}---${after}${body}`;
}

export function estimateSkillTokenUsage(content: string): {
  frontmatterTokens: number;
  instructionTokens: number;
} {
  const parts = locateFrontmatter(content);
  const body = parseSkillContent(content).body;
  return {
    frontmatterTokens: estimateTokens(parts?.yaml ?? ""),
    instructionTokens: estimateTokens(body),
  };
}

export function getSkillFrontmatterYaml(content: string): string {
  return locateFrontmatter(content)?.yaml ?? "";
}

function estimateTokens(value: string): number {
  return Math.ceil(new TextEncoder().encode(value).length / 4);
}

function locateFrontmatter(content: string) {
  const match = content.match(/^(\uFEFF?\s*?)---(\r\n|\r|\n)([\s\S]*?)(\r\n|\r|\n)---([\s\S]*)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    openingNewline: match[2],
    yaml: match[3],
    closingPrefix: match[4],
    after: match[5],
  };
}

function serializeField(key: string, value: unknown, newline: string): string[] {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    return value.length === 0
      ? []
      : [`${key}:`, ...value.map((entry) => `  - ${yamlEscapeScalar(String(entry))}`)];
  }
  if (typeof value === "boolean") return [`${key}: ${value ? "true" : "false"}`];
  void newline;
  return [`${key}: ${yamlEscapeScalar(String(value))}`];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assignKnownFrontmatterKey(frontmatter: SkillFrontmatter, key: string, value: string) {
  if (key === "name") frontmatter.name = value;
  else if (key === "description") frontmatter.description = value;
  else if (key === "auto_attach") frontmatter.auto_attach = value === "true";
  else if (key === "argument-hint") frontmatter["argument-hint"] = value;
  else if (key === "allowed-tools") frontmatter["allowed-tools"] = value;
  else if (key === "user-invocable") frontmatter["user-invocable"] = value !== "false";
  else if (key === "disable-model-invocation") {
    frontmatter["disable-model-invocation"] = value === "true";
  }
}

function yamlEscapeScalar(value: string): string {
  if (!value) return '""';

  const lower = value.toLowerCase();
  const isYamlKeyword = ["true", "false", "yes", "no", "on", "off", "null", "~"].includes(lower);
  const needsQuoting =
    isYamlKeyword ||
    value.includes(":") ||
    value.includes("#") ||
    value.includes("\n") ||
    value.includes('"') ||
    value.includes("'") ||
    value.startsWith("[") ||
    value.startsWith("{") ||
    value.startsWith(">") ||
    value.startsWith("|") ||
    value.startsWith("&") ||
    value.startsWith("*") ||
    value.startsWith("!") ||
    value.startsWith("%") ||
    value.startsWith("@") ||
    value.startsWith("`") ||
    value.includes("---");

  if (!needsQuoting) return value;

  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

function yamlUnescapeScalar(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return decodeDoubleQuotedScalar(value.slice(1, -1));
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

function decodeDoubleQuotedScalar(value: string): string {
  let decoded = "";

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== "\\") {
      decoded += char;
      continue;
    }

    const next = value[i + 1];
    if (next === undefined) {
      decoded += "\\";
      continue;
    }

    if (next === "n") decoded += "\n";
    else if (next === '"') decoded += '"';
    else if (next === "\\") decoded += "\\";
    else {
      decoded += "\\";
      decoded += next;
    }
    i++;
  }

  return decoded;
}
