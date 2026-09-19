import type { AgentFields, SubagentOverride, SubagentSettings } from "@tracepilot/types";

/** Where an effective value comes from, in precedence order. */
export type ConfigSource = "settings" | "definition" | "session" | "cli";

export interface EffectiveValue {
  value: string | null;
  source: ConfigSource;
  /** One-line explanation, e.g. "from /subagents setting; definition says X". */
  detail: string;
}

export interface EffectiveAgentConfig {
  /** Primary model first, then definition fallbacks when they apply. */
  models: EffectiveValue[];
  effort: EffectiveValue;
  contextTier: EffectiveValue;
  tools: { value: string[] | null; source: ConfigSource; detail: string };
  /** `model-policy: required` blocks falling back to other models. */
  modelPolicyRequired: boolean;
  disabled: boolean;
}

const INHERIT = "inherit";

function fromSetting(
  value: string | null | undefined,
  sessionValue: string | null,
  what: string,
  definitionValue: string | null,
): EffectiveValue | null {
  if (!value) return null;
  const shadowed = definitionValue ? `; definition says ${definitionValue}` : "";
  if (value === INHERIT) {
    return {
      value: sessionValue,
      source: "settings",
      detail: `/subagents setting inherits the session ${what}${sessionValue ? ` (${sessionValue})` : ""}${shadowed}`,
    };
  }
  return { value, source: "settings", detail: `from /subagents setting${shadowed}` };
}

/**
 * Resolve the model chain, effort, context tier and tools an agent runs
 * with, and where each comes from. At runtime an explicit `model` in the
 * launching task call still wins over all of these.
 */
export function resolveEffectiveConfig(
  fields: AgentFields | null,
  override: SubagentOverride | null,
  settings: SubagentSettings | null,
  disabled = false,
): EffectiveAgentConfig {
  const sessionModel = settings?.sessionModel ?? null;
  const sessionEffort = settings?.sessionEffort ?? null;
  const definitionModels = fields?.models ?? [];
  const primaryDefinition = definitionModels[0] ?? null;

  const modelOverride = fromSetting(override?.model, sessionModel, "model", primaryDefinition);
  let models: EffectiveValue[];
  if (modelOverride) {
    models = [modelOverride];
  } else if (definitionModels.length > 0) {
    models = definitionModels.map((model, index) => ({
      value: model,
      source: "definition",
      detail: index === 0 ? "from the definition" : `fallback ${index} from the definition`,
    }));
  } else if (fields) {
    models = [
      {
        value: sessionModel,
        source: "session",
        detail: "the definition sets no model, so the session model is used",
      },
    ];
  } else {
    models = [
      { value: null, source: "cli", detail: "chosen by Copilot CLI (definition unavailable)" },
    ];
  }

  const effort =
    fromSetting(override?.effortLevel, sessionEffort, "effort", fields?.reasoningEffort ?? null) ??
    (fields?.reasoningEffort
      ? { value: fields.reasoningEffort, source: "definition", detail: "from the definition" }
      : {
          value: sessionEffort,
          source: "session",
          detail: "not set, so the session effort applies",
        });

  const contextTier =
    fromSetting(override?.contextTier, null, "context tier", fields?.contextTier ?? null) ??
    (fields?.contextTier
      ? { value: fields.contextTier, source: "definition", detail: "from the definition" }
      : { value: "default", source: "cli", detail: "CLI default" });

  const tools = fields
    ? fields.tools
      ? { value: fields.tools, source: "definition" as const, detail: "listed in the definition" }
      : {
          value: null,
          source: "definition" as const,
          detail: "no tools key: every tool is available",
        }
    : { value: null, source: "cli" as const, detail: "chosen by Copilot CLI" };

  return {
    models,
    effort,
    contextTier,
    tools,
    modelPolicyRequired: !modelOverride && fields?.modelPolicy === "required",
    disabled,
  };
}
