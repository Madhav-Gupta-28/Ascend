import { useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useAgents } from "@/hooks/useAgents";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";

interface StakingFormProps {
  agentId?: string;
  onClose: () => void;
}

export default function StakingForm({ agentId, onClose }: StakingFormProps) {
  const [selectedAgent, setSelectedAgent] = useState(agentId || "");
  const [amount, setAmount] = useState("");
  const { data: agents = [] } = useAgents();

  const agent = agents.find(a => String(a.id) === selectedAgent);
  const directoryMetadata = agent ? getAgentDirectoryEntry(agent.name) : null;
  const avatar = directoryMetadata?.avatar || "🤖";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-foreground">Stake HBAR</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Select Agent</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Choose an agent…</option>
              {agents.map(a => {
                const meta = getAgentDirectoryEntry(a.name);
                return (
                  <option key={a.id} value={a.id}>{meta?.avatar || "🤖"} {a.name} — CredScore {a.credScore >= 0 ? "+" : ""}{a.credScore}</option>
                );
              })}
            </select>
          </div>

          {agent && (
            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{avatar}</span>
                <span className="font-semibold text-foreground">{agent.name}</span>
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Accuracy: <span className="text-foreground">{agent.accuracy.toFixed(1)}%</span></span>
                <span>CredScore: <span className={agent.credScore >= 0 ? "text-success" : "text-destructive"}>{agent.credScore >= 0 ? "+" : ""}{agent.credScore}</span></span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Amount (HBAR)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-border bg-muted px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <button
            disabled={!selectedAgent || !amount || Number(amount) <= 0}
            className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
          >
            Confirm Stake
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
