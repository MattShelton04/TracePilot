export interface AgentMeta {
  emoji: string;
  colorVar: string;
  motto: string;
}

export const AGENT_META: Readonly<Record<string, AgentMeta>> = Object.freeze({
  explore: { emoji: "🔍", colorVar: "--accent-emphasis", motto: "Fast & thorough explorer" },
  task: { emoji: "⚡", colorVar: "--warning-emphasis", motto: "Reliable command runner" },
  "code-review": {
    emoji: "📝",
    colorVar: "--success-emphasis",
    motto: "High signal-to-noise reviewer",
  },
  research: { emoji: "🔬", colorVar: "--done-emphasis", motto: "Deep analysis specialist" },
  "configure-copilot": {
    emoji: "⚙️",
    colorVar: "--neutral-emphasis",
    motto: "System configurator",
  },
});

export const DEFAULT_AGENT_META: AgentMeta = Object.freeze({
  emoji: "🤖",
  colorVar: "--neutral-emphasis",
  motto: "",
});

export function agentMeta(name: string): AgentMeta {
  return AGENT_META[name] ?? DEFAULT_AGENT_META;
}
