import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import StakingForm from "@/components/StakingForm";
import { Wallet, TrendingUp, Plus, ArrowDownToLine, Loader2 } from "lucide-react";
import { useHederaWallet } from "@/hooks/use-hedera-wallet";
import { useStakingPortfolio } from "@/hooks/useStaking";
import { useAgents } from "@/hooks/useAgents";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";

export default function StakingDashboard() {
  const [showStakeModal, setShowStakeModal] = useState(false);
  const { selectedAccountId } = useHederaWallet();

  const { data: portfolio, isLoading: isPortfolioLoading } = useStakingPortfolio();
  const { data: agents = [] } = useAgents();

  const totalStaked = portfolio ? Number(portfolio.totalStaked) / 1e8 : 0;

  // Calculate total across all positions
  let totalRewards = 0n;
  if (portfolio?.positions) {
    Object.values(portfolio.positions).forEach(p => {
      totalRewards += p.pendingReward;
    });
  }
  const totalRewardsHbar = Number(totalRewards) / 1e8;

  const positionsList = portfolio?.positions ? Object.entries(portfolio.positions) : [];

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-foreground mb-1">Staking Dashboard</h1>
        <p className="text-sm text-muted-foreground">Stake HBAR on the most intelligent agents</p>
      </motion.div>

      {/* Portfolio overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Wallet Connection</span>
          </div>
          <div className="font-mono text-lg font-bold text-foreground truncate">
            {selectedAccountId || "Connect HashPack"}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownToLine className="h-4 w-4 text-secondary" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Staked</span>
          </div>
          <div className="font-mono text-2xl font-bold text-foreground">
            {totalStaked.toLocaleString()} <span className="text-sm text-muted-foreground">HBAR</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-success" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pending Rewards</span>
          </div>
          <div className="font-mono text-2xl font-bold text-success">
            +{totalRewardsHbar.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm text-muted-foreground">HBAR</span>
          </div>
        </motion.div>
      </div>

      {/* Positions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-2xl border border-border bg-card p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-foreground">Your Positions</h2>
            {isPortfolioLoading && selectedAccountId && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <button
            onClick={() => setShowStakeModal(true)}
            disabled={!selectedAccountId}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors glow-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" /> Stake
          </button>
        </div>

        <div className="overflow-x-auto">
          {!selectedAccountId ? (
            <div className="text-center py-10 text-muted-foreground text-sm border border-dashed border-border rounded-xl">
              Please connect your HashPack wallet to view your staking positions.
            </div>
          ) : positionsList.length === 0 && !isPortfolioLoading ? (
            <div className="text-center py-10 text-muted-foreground text-sm border border-dashed border-border rounded-xl">
              You don't have any active stakes. Back an agent to start earning rewards.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="pb-3 pr-4">Agent</th>
                  <th className="pb-3 pr-4">Staked</th>
                  <th className="pb-3 pr-4">Rewards</th>
                  <th className="pb-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {positionsList.map(([agentIdStr, pos], i) => {
                  const agentId = Number(agentIdStr);
                  const agent = agents.find(a => Number(a.id) === agentId);
                  const directoryMetadata = getAgentDirectoryEntry(agent?.name || String(agentId));
                  const avatar = directoryMetadata?.avatar || "🤖";

                  const amountHbar = Number(pos.stake.amount) / 1e8;
                  const rewardHbar = Number(pos.pendingReward) / 1e8;

                  return (
                    <motion.tr
                      key={agentId}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.05 }}
                      className="text-sm"
                    >
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{avatar}</span>
                          <span className="font-semibold text-foreground">{agent?.name || `Agent #${agentId}`}</span>
                        </div>
                      </td>
                      <td className="py-4 pr-4 font-mono text-foreground">{amountHbar.toLocaleString()} HBAR</td>
                      <td className="py-4 pr-4 font-mono text-success">+{rewardHbar.toLocaleString(undefined, { maximumFractionDigits: 2 })} HBAR</td>
                      <td className="py-4">
                        <button className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors">
                          Unstake
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showStakeModal && <StakingForm onClose={() => setShowStakeModal(false)} />}
      </AnimatePresence>
    </div>
  );
}
