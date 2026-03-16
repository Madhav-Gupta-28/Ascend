import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import StakingForm from "@/components/StakingForm";
import { TrendingUp, Plus, ArrowDownToLine, Loader2, Users, Wallet, CheckCircle2 } from "lucide-react";
import { useHederaWallet } from "@/hooks/use-hedera-wallet";
import { useStakingPortfolio } from "@/hooks/useStaking";
import { useAgents } from "@/hooks/useAgents";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { CONTRACT_ADDRESSES, STAKING_VAULT_ABI } from "@/lib/contracts";
import { formatHbar } from "@/lib/hedera";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

export default function StakingDashboard() {
  const [showStakeModal, setShowStakeModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState<Record<string, boolean>>({});
  const { selectedAccountId, executeContractFunction } = useHederaWallet();
  const queryClient = useQueryClient();

  const { data: portfolio, isLoading: isPortfolioLoading } = useStakingPortfolio();
  const { data: agents = [] } = useAgents();

  const totalStaked = portfolio ? Number(formatHbar(portfolio.totalStaked)) : 0;

  let totalRewards = 0n;
  if (portfolio?.positions) {
    Object.values(portfolio.positions).forEach((position) => {
      totalRewards += position.pendingReward;
    });
  }
  const totalRewardsHbar = Number(formatHbar(totalRewards));

  const positionsList = portfolio?.positions ? Object.entries(portfolio.positions) : [];
  const totalAgentsBacked = positionsList.length;

  const handleUnstake = async (agentId: number, amountRaw: bigint) => {
    if (!selectedAccountId) return;
    try {
      setIsProcessing((p) => ({ ...p, [`unstake-${agentId}`]: true }));
      toast.loading("Sending unstake transaction...", { id: `unstake-${agentId}` });
      await executeContractFunction(
        CONTRACT_ADDRESSES.stakingVault,
        STAKING_VAULT_ABI,
        "unstake",
        [agentId, amountRaw.toString()]
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["stakingPortfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["stakingTVL"] }),
        queryClient.invalidateQueries({ queryKey: ["agents"] }),
      ]);
      toast.success("Successfully unstaked HBAR!", { id: `unstake-${agentId}` });
    } catch (err: any) {
      console.error("Unstaking failed:", err);
      toast.error(`Unstake failed: ${err.message || "Unknown error"}`, { id: `unstake-${agentId}` });
    } finally {
      setIsProcessing((p) => ({ ...p, [`unstake-${agentId}`]: false }));
    }
  };

  const handleClaim = async (agentId: number) => {
    if (!selectedAccountId) return;
    try {
      setIsProcessing((p) => ({ ...p, [`claim-${agentId}`]: true }));
      toast.loading("Claiming rewards...", { id: `claim-${agentId}` });
      await executeContractFunction(
        CONTRACT_ADDRESSES.stakingVault,
        STAKING_VAULT_ABI,
        "claimReward",
        [agentId]
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["stakingPortfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["stakingTVL"] }),
        queryClient.invalidateQueries({ queryKey: ["agents"] }),
      ]);
      toast.success("Successfully claimed rewards!", { id: `claim-${agentId}` });
    } catch (err: any) {
      console.error("Claiming failed:", err);
      toast.error(`Claim failed: ${err.message || "Unknown error"}`, { id: `claim-${agentId}` });
    } finally {
      setIsProcessing((p) => ({ ...p, [`claim-${agentId}`]: false }));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="terminal-surface px-6 py-7 md:px-7 md:py-8">
          <p className="section-kicker">Staking Terminal</p>
          <h1 className="mt-1 font-display text-4xl uppercase tracking-[-0.03em] text-foreground md:text-5xl">
            Agent Backing Vault
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Stake HBAR on top agents and track position performance across every round.
          </p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="terminal-surface p-6"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-card">
              <ArrowDownToLine className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Value Staked</span>
          </div>
          <div className="font-mono text-4xl font-bold text-foreground truncate">{totalStaked.toLocaleString()}</div>
          <div className="mt-1 text-sm font-medium text-muted-foreground">HBAR</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="terminal-surface p-6"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-card">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending Yield</span>
          </div>
          <div className="font-mono text-4xl font-bold text-foreground truncate">
            +{totalRewardsHbar.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1 text-sm font-medium text-muted-foreground">HBAR</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="terminal-surface p-6"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-card">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agents Backed</span>
          </div>
          <div className="font-mono text-4xl font-bold text-foreground">{totalAgentsBacked}</div>
          <div className="mt-1 text-sm font-medium text-muted-foreground">Positions</div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-3xl border border-border bg-card overflow-hidden shadow-sm"
      >
        <div className="flex flex-col items-center justify-between gap-4 border-b border-border p-6 md:flex-row md:p-8">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl uppercase tracking-[-0.018em] text-foreground">Backing Positions</h2>
            {isPortfolioLoading && selectedAccountId && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <button
            onClick={() => setShowStakeModal(true)}
            disabled={!selectedAccountId}
            className="w-full md:w-auto flex items-center justify-center gap-2 rounded-sm border border-secondary/45 bg-secondary/15 px-6 py-3 text-sm font-bold uppercase tracking-[0.06em] text-secondary transition-all hover:-translate-y-0.5 hover:border-secondary/70 hover:bg-secondary/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            style={{ boxShadow: "0 10px 22px rgba(0,0,0,0.45), 0 0 0 1px rgba(72,223,123,0.16)" }}
          >
            <Plus className="h-4 w-4" /> New Position
          </button>
        </div>

        <div className="overflow-x-auto">
          {!selectedAccountId ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                <Wallet className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Wallet Disconnected</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Connect your HashPack wallet to view your active staking positions and claim yield.
              </p>
            </div>
          ) : positionsList.length === 0 && !isPortfolioLoading ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                <Users className="h-8 w-8 text-primary" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">No Active Stakes</h3>
              <p className="mb-6 max-w-sm text-sm text-muted-foreground">
                You haven&apos;t backed any agents yet. Stake HBAR on top performers to start earning yield.
              </p>
              <Link
                href="/agents"
                className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                Browse Agents
              </Link>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/30 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-6 py-4">Agent Profile</th>
                  <th className="px-6 py-4 text-right">Principal Staked</th>
                  <th className="px-6 py-4 text-right">Pending Yield</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {positionsList.map(([agentIdStr, position], i) => {
                  const agentId = Number(agentIdStr);
                  const agent = agents.find((a) => Number(a.id) === agentId);
                  const avatar = getAgentDirectoryEntry(agent?.name || String(agentId))?.avatar || "🤖";

                  const amountHbar = Number(formatHbar(position.stake.amount));
                  const rewardHbar = Number(formatHbar(position.pendingReward));

                  return (
                    <motion.tr
                      key={agentId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.05 }}
                      className="group transition-colors hover:bg-muted/20"
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
                            {avatar}
                          </div>
                          <div>
                            <Link href={`/agent/${agentId}`} className="font-semibold text-foreground transition-colors group-hover:text-primary">
                              {agent?.name || `Agent #${agentId}`}
                            </Link>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">ID: #{agentId}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <div className="font-mono text-base font-bold text-foreground">{amountHbar.toLocaleString()}</div>
                        <div className="text-[10px] uppercase text-muted-foreground">HBAR</div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <div className="font-mono text-base font-bold text-foreground">
                          +{rewardHbar.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] uppercase text-muted-foreground">HBAR</div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {rewardHbar > 0 && (
                            <button
                              onClick={() => handleClaim(agentId)}
                              disabled={isProcessing[`claim-${agentId}`] || isProcessing[`unstake-${agentId}`]}
                              className="inline-flex min-w-[80px] items-center justify-center rounded-lg border border-success/30 bg-success/10 px-4 py-2 text-xs font-bold text-success transition-colors hover:bg-success/20 disabled:opacity-50"
                            >
                              {isProcessing[`claim-${agentId}`] ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Claim
                            </button>
                          )}
                          <button
                            onClick={() => handleUnstake(agentId, position.stake.amount)}
                            disabled={isProcessing[`unstake-${agentId}`]}
                            className="inline-flex min-w-[90px] items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            {isProcessing[`unstake-${agentId}`] ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Unstake Full
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </motion.div>

      <AnimatePresence>{showStakeModal && <StakingForm onClose={() => setShowStakeModal(false)} />}</AnimatePresence>
    </div>
  );
}
