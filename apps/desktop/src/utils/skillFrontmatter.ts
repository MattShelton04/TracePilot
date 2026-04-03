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

    if (inMultiline && currentKey) {
      assignKnownFrontmatterKey(frontmatter, currentKey, multilineValue.trim());
      inMultiline = false;
      multilineValue = "";
    }
    inGlobs = false;
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
}

function assignKnownFrontmatterKey(frontmatter: SkillFrontmatter, key: string, value: string) {
  if (key === "name") frontmatter.name = value;
  else if (key === "description") frontmatter.description = value;
  else if (key === "auto_attach") frontmatter.auto_attach = value === "true";
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
    else decoded += next;
    i++;
  }

  return decoded;
}
