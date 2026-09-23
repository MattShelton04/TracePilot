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
  "general-purpose": {
    iconName: "bot",
    colorVar: "--accent-emphasis",
    motto: "Full-capability delegate",
  },
  "security-review": {
    iconName: "shield",
    colorVar: "--danger-emphasis",
    motto: "Secrets and vulnerability auditor",
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

/**
 * Built-in agents that can run without a definition file on disk: the CLI
 * embeds some (e.g. `general-purpose`) in its binary, and older package
 * versions shipped others. Session evidence for these names is shown as a
 * built-in whose definition is unavailable rather than as unresolved.
 */
export const KNOWN_BUILTIN_AGENTS: ReadonlySet<string> = new Set([
  "code-review",
  "explore",
  "general-purpose",
  "rem-agent",
  "research",
  "rubber-duck",
  "search-subagent",
  "security-review",
  "task",
]);

export interface EmbeddedAgentIdentity {
  displayName: string;
  description: string;
}

/**
 * How the CLI describes built-ins that have no definition file. Newer CLIs
 * report the launching call's `name` and `description` for these agents, so
 * session evidence describes one run rather than the agent; this copy does not
 * change from run to run.
 */
export const EMBEDDED_AGENT_IDENTITY: Readonly<Record<string, EmbeddedAgentIdentity>> =
  Object.freeze({
    "general-purpose": {
      displayName: "General Purpose Agent",
      description:
        "Full-capability agent running in a subprocess. Use for complex multi-step tasks requiring the complete toolset and high-quality reasoning. Runs in a separate context window to keep your main conversation clean.",
    },
  });
