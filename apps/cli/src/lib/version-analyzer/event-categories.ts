export function categorizeEvent(name: string): string {
  const prefix = name.split(".")[0];
  const mapping: Record<string, string> = {
    session: "Session",
    user: "User",
    assistant: "Assistant",
    tool: "Tool",
    subagent: "Subagent",
    system: "System",
    skill: "Skill",
    hook: "Hook",
    permission: "Permission",
    elicitation: "Input",
    user_input: "Input",
    external_tool: "External",
    command: "Command",
    exit_plan_mode: "Plan",
    pending_messages: "User",
    abort: "Control",
  };
  return mapping[prefix] ?? mapping[name] ?? "Other";
}
