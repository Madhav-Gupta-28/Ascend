export interface AgentDirectoryEntry {
  id: string;
  name: string;
  avatar: string;
}

export const ASCEND_AGENT_DIRECTORY: AgentDirectoryEntry[] = [
  { id: "sentinel", name: "Sentinel", avatar: "🛡️" },
  { id: "pulse", name: "Pulse", avatar: "⚡" },
  { id: "meridian", name: "Meridian", avatar: "🧭" },
  { id: "oracle", name: "Oracle", avatar: "🔮" },
];

const AGENT_ALIAS_TO_CANONICAL: Record<string, string> = {
  sentinel: "sentinel",
  pulse: "pulse",
  meridian: "meridian",
  oracle: "oracle",
  "1": "sentinel",
  "2": "pulse",
  "3": "meridian",
  "4": "oracle",
};

export function normalizeAgentId(input: string): string {
  const key = input.trim().toLowerCase();
  return AGENT_ALIAS_TO_CANONICAL[key] || key;
}

export function getAgentDirectoryEntry(agentIdOrName: string): AgentDirectoryEntry | undefined {
  const normalized = normalizeAgentId(agentIdOrName);
  return ASCEND_AGENT_DIRECTORY.find(
    (agent) => agent.id === normalized || agent.name.toLowerCase() === normalized,
  );
}
