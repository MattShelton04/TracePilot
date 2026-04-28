export interface AskUserField {
  name: string;
  type: string;
  title: string;
  description?: string;
  required: boolean;
  enumValues: string[];
  defaultValue?: unknown;
}

export interface AskUserResponseValue {
  field: AskUserField;
  value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function askUserPrompt(args: Record<string, unknown>): string | null {
  if (typeof args.message === "string") return args.message;
  if (typeof args.question === "string") return args.question;
  return null;
}

export function askUserChoices(args: Record<string, unknown>): string[] {
  return Array.isArray(args.choices)
    ? args.choices.filter((choice): choice is string => typeof choice === "string")
    : [];
}

export function askUserAllowFreeform(args: Record<string, unknown>): boolean {
  return args.allow_freeform !== false;
}

export function askUserFields(args: Record<string, unknown>): AskUserField[] {
  if (!isRecord(args.requestedSchema)) return [];
  const schema = args.requestedSchema;
  if (!isRecord(schema.properties)) return [];

  const required = Array.isArray(schema.required)
    ? new Set(schema.required.filter((key): key is string => typeof key === "string"))
    : new Set<string>();

  return Object.entries(schema.properties).map(([name, rawField]) => {
    const field = isRecord(rawField) ? rawField : {};
    const type = typeof field.type === "string" ? field.type : "string";
    const title = typeof field.title === "string" ? field.title : name;
    const description = typeof field.description === "string" ? field.description : undefined;
    const enumValues = Array.isArray(field.enum)
      ? field.enum.map((value) => formatAskUserValue(value))
      : [];

    return {
      name,
      type,
      title,
      description,
      required: required.has(name),
      enumValues,
      defaultValue: Object.hasOwn(field, "default") ? field.default : undefined,
    };
  });
}

export function parseAskUserResponseValues(
  content: string,
  fields: AskUserField[],
): AskUserResponseValue[] {
  const trimmed = content.trim();
  if (!trimmed || fields.length === 0) return [];

  const parsedObject = parseStructuredResponse(trimmed);
  if (!parsedObject) return [];

  return fields
    .filter((field) => Object.hasOwn(parsedObject, field.name))
    .map((field) => ({ field, value: parsedObject[field.name] }));
}

function parseStructuredResponse(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // Continue below. Current CLI ask_user results commonly use:
    // "User responded: key=value, other_key=value".
  }

  const unprefixed = stripResponsePrefix(content);
  const keyValuePairs = parseKeyValueResponse(unprefixed);
  return Object.keys(keyValuePairs).length > 0 ? keyValuePairs : null;
}

function stripResponsePrefix(content: string): string {
  const prefixes = [
    "User responded:",
    "User response:",
    "Response:",
    "Selected:",
    "User selected:",
  ];
  const lower = content.toLowerCase();
  const prefix = prefixes.find((candidate) => lower.startsWith(candidate.toLowerCase()));
  return prefix ? content.slice(prefix.length).trim() : content;
}

function parseKeyValueResponse(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  const pairPattern = /(?:^|,\s*)([A-Za-z_][\w.-]*)=([\s\S]*?)(?=,\s*[A-Za-z_][\w.-]*=|$)/g;

  for (const match of content.matchAll(pairPattern)) {
    values[match[1]] = match[2].trim();
  }

  return values;
}

export function formatAskUserValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => formatAskUserValue(item)).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
