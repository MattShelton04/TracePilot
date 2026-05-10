export interface AgentMeta {
  /** Lucide kebab-case icon name. Rendered via <component :is>. */
  iconName: string;
  colorVar: string;
  motto: string;
}

export const AGENT_META: Readonly<Record<string, AgentMeta>> = Object.freeze({
  explore: { iconName: "search", colorVar: "--accent-emphasis", motto: "Fast & thorough explorer" },
  task: { iconName: "zap", colorVar: "--warning-emphasis", motto: "Reliable command runner" },
  "code-review": {
    iconName: "file-pen-line",
    colorVar: "--success-emphasis",
    motto: "High signal-to-noise reviewer",
  },
  "rubber-duck": {
    iconName: "message-circle",
    colorVar: "--agent-color-rubber-duck",
    motto: "Pragmatic feedback partner",
  },
  research: {
    iconName: "microscope",
    colorVar: "--done-emphasis",
    motto: "Deep analysis specialist",
  },
  "configure-copilot": {
    iconName: "settings",
    colorVar: "--neutral-emphasis",
    motto: "System configurator",
  },
});

export const DEFAULT_AGENT_META: AgentMeta = Object.freeze({
  iconName: "bot",
  colorVar: "--neutral-emphasis",
  motto: "",
});

export function agentMeta(name: string): AgentMeta {
  return AGENT_META[name] ?? DEFAULT_AGENT_META;
}
