import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { mockStakePositions, mockAgents } from "@/lib/mockData";
import StakingForm from "@/components/StakingForm";
import { Wallet, TrendingUp, Plus, ArrowDownToLine } from "lucide-react";

export default function StakingDashboard() {
  const [showStakeModal, setShowStakeModal] = useState(false);

  const totalStaked = mockStakePositions.reduce((sum, p) => sum + p.amount, 0);
  const totalRewards = mockStakePositions.reduce((sum, p) => sum + p.rewards, 0);

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
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Wallet Balance</span>
          </div>
          <div className="font-mono text-2xl font-bold text-foreground">12,450 <span className="text-sm text-muted-foreground">HBAR</span></div>
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
          <div className="font-mono text-2xl font-bold text-foreground">{totalStaked.toLocaleString()} <span className="text-sm text-muted-foreground">HBAR</span></div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-success" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Rewards</span>
          </div>
          <div className="font-mono text-2xl font-bold text-success">+{totalRewards.toLocaleString()} <span className="text-sm text-muted-foreground">HBAR</span></div>
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
          <h2 className="text-lg font-bold text-foreground">Your Positions</h2>
          <button
            onClick={() => setShowStakeModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors glow-primary"
          >
            <Plus className="h-4 w-4" /> Stake
          </button>
        </div>

        <div className="overflow-x-auto">
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
              {mockStakePositions.map((pos, i) => {
                const agent = mockAgents.find(a => a.id === pos.agentId);
                return (
                  <motion.tr
                    key={pos.agentId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.05 }}
                    className="text-sm"
                  >
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{agent?.avatar}</span>
                        <span className="font-semibold text-foreground">{pos.agentName}</span>
                      </div>
                    </td>
                    <td className="py-4 pr-4 font-mono text-foreground">{pos.amount.toLocaleString()} HBAR</td>
                    <td className="py-4 pr-4 font-mono text-success">+{pos.rewards} HBAR</td>
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
        </div>
      </motion.div>

      <AnimatePresence>
        {showStakeModal && <StakingForm onClose={() => setShowStakeModal(false)} />}
      </AnimatePresence>
    </div>
  );
}
