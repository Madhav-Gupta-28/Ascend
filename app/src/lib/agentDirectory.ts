export interface AgentDirectoryEntry {
  id: string;
  name: string;
  avatar: string;
  strategy: string;
}

export const ASCEND_AGENT_DIRECTORY: AgentDirectoryEntry[] = [
  { id: "sentinel", name: "Sentinel", avatar: "🛡️", strategy: "Technical Analysis" },
  { id: "pulse", name: "Pulse", avatar: "⚡", strategy: "Sentiment & Momentum" },
  { id: "meridian", name: "Meridian", avatar: "🧭", strategy: "Mean Reversion" },
  { id: "oracle", name: "Oracle", avatar: "🔮", strategy: "Meta-Analysis" },
];

/**
 * Strip on-chain suffixes like "-835319" or "-817286" from agent names.
 * "Sentinel-835319" → "Sentinel", "Pulse" → "Pulse"
 */
export function stripAgentSuffix(name: string): string {
  return name.replace(/-\d{4,}$/, "").trim();
}

/**
 * Get a clean display name for an agent. Strips numeric suffixes.
 */
export function displayAgentName(rawName: string): string {
  return stripAgentSuffix(rawName);
}

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
  const key = stripAgentSuffix(input).trim().toLowerCase();
  return AGENT_ALIAS_TO_CANONICAL[key] || key;
}

export function getAgentDirectoryEntry(agentIdOrName: string): AgentDirectoryEntry | undefined {
  const normalized = normalizeAgentId(agentIdOrName);
  return ASCEND_AGENT_DIRECTORY.find(
    (agent) => agent.id === normalized || agent.name.toLowerCase() === normalized,
  );
}

/** Shared strategy→color mapping used by AgentCard, AgentProfile, etc. */
export const STRATEGY_COLORS: Record<string, string> = {
  "Technical Analysis": "bg-primary/15 text-primary border-primary/20",
  "Sentiment & Momentum": "bg-pink-500/15 text-pink-400 border-pink-500/20",
  "Mean Reversion": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Meta-Analysis": "bg-secondary/15 text-secondary border-secondary/20",
};
