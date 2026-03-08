import { useState } from "react";
import { motion } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import { useAgents } from "@/hooks/useAgents";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { CONTRACT_ADDRESSES, STAKING_VAULT_ABI } from "@/lib/contracts";
import { useHederaWallet } from "@/hooks/use-hedera-wallet";
import { ethers } from "ethers";
import { toast } from "sonner";
import { parseHbar } from "@/lib/hedera";

interface StakingFormProps {
  agentId?: string;
  onClose: () => void;
}

export default function StakingForm({ agentId, onClose }: StakingFormProps) {
  const [selectedAgent, setSelectedAgent] = useState(agentId || "");
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: agents = [] } = useAgents();
  const { isConnected, executeContractFunction } = useHederaWallet();

  const agent = agents.find(a => String(a.id) === selectedAgent);
  const directoryMetadata = agent ? getAgentDirectoryEntry(agent.name) : null;
  const avatar = directoryMetadata?.avatar || "🤖";

  const handleStake = async () => {
    if (!isConnected) {
      toast.error("Please connect your wallet first");
      return;
    }

    if (!selectedAgent || !amount || Number(amount) <= 0) return;

    try {
      setIsSubmitting(true);
      const amountInTinybars = parseHbar(amount).toString();

      toast.loading("Sending transaction to wallet...", { id: "stake-tx" });

      const receipt = await executeContractFunction(
        CONTRACT_ADDRESSES.stakingVault,
        STAKING_VAULT_ABI,
        "stake",
        [selectedAgent],
        amountInTinybars
      );

      toast.success("Successfully staked on AI Agent!", { id: "stake-tx" });
      onClose();
    } catch (err: any) {
      console.error("Staking failed:", err);
      toast.error(`Transaction failed: ${err.message || "Unknown error"}`, { id: "stake-tx" });
    } finally {
      setIsSubmitting(false);
    }
  };

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
              disabled={isSubmitting}
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
              disabled={isSubmitting}
            />
          </div>

          <button
            onClick={handleStake}
            disabled={!selectedAgent || !amount || Number(amount) <= 0 || isSubmitting}
            className="w-full flex items-center justify-center rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing Transaction
              </>
            ) : !isConnected ? (
              "Connect Wallet to Stake"
            ) : (
              "Confirm Stake"
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
