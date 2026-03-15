import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import StakingForm from "@/components/StakingForm";
import { TrendingUp, Plus, ArrowDownToLine, Loader2, Users, Wallet, CheckCircle2, ShieldCheck, Info } from "lucide-react";
import { useHederaWallet } from "@/hooks/use-hedera-wallet";
import { useStakingPortfolio } from "@/hooks/useStaking";
import { useAgents } from "@/hooks/useAgents";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { CONTRACT_ADDRESSES, STAKING_VAULT_ABI } from "@/lib/contracts";
import { formatHbar } from "@/lib/hedera";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

export default function StakingDashboard() {
  const [showStakeModal, setShowStakeModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState<Record<string, boolean>>({});
  const { selectedAccountId, executeContractFunction } = useHederaWallet();
  const queryClient = useQueryClient();

  const { data: portfolio, isLoading: isPortfolioLoading } = useStakingPortfolio();
  const { data: agents = [] } = useAgents();

  const totalStaked = portfolio ? Number(formatHbar(portfolio.totalStaked)) : 0;

  // Calculate total across all positions
  let totalRewards = 0n;
  if (portfolio?.positions) {
    Object.values(portfolio.positions).forEach(p => {
      totalRewards += p.pendingReward;
    });
  }
  const totalRewardsHbar = Number(formatHbar(totalRewards));

  const positionsList = portfolio?.positions ? Object.entries(portfolio.positions) : [];
  const totalAgentsBacked = positionsList.length;

  const handleUnstake = async (agentId: number, amountRaw: bigint) => {
    if (!selectedAccountId) return;
    try {
      setIsProcessing(p => ({ ...p, [`unstake-${agentId}`]: true }));
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
      setIsProcessing(p => ({ ...p, [`unstake-${agentId}`]: false }));
    }
  };

  const handleClaim = async (agentId: number) => {
    if (!selectedAccountId) return;
    try {
      setIsProcessing(p => ({ ...p, [`claim-${agentId}`]: true }));
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
      setIsProcessing(p => ({ ...p, [`claim-${agentId}`]: false }));
    }
  };

  return (
    <TooltipProvider>
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Intelligence Vault</h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[10px] font-mono font-bold text-primary uppercase tracking-widest cursor-help">
                <ShieldCheck className="h-3 w-3" /> EVM Vault
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Stakes are held in a Hedera-deployed Solidity smart contract. Yield is distributed automatically when agent predictions resolve correctly on-chain.
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
          Back the most intelligent AI agents with HBAR. Your stake signals agent reputation and earns yield when backed agents make correct on-chain predictions.
        </p>
      </motion.div>

      {/* Portfolio overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-border bg-gradient-to-br from-card to-card/50 p-6 flex flex-col justify-between"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <ArrowDownToLine className="h-5 w-5 text-primary" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Value Staked</span>
          </div>
          <div>
             <div className="font-mono text-4xl font-extrabold text-foreground truncate">
              {totalStaked.toLocaleString()}
            </div>
            <div className="text-sm font-medium text-muted-foreground mt-1">HBAR</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-success/20 bg-gradient-to-br from-success/5 to-transparent p-6 flex flex-col justify-between relative overflow-hidden"
        >
          <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-success/10 blur-2xl" />
          <div className="flex items-center gap-3 mb-6 relative">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/20">
              <TrendingUp className="h-5 w-5 text-success" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-success">Pending Yield</span>
          </div>
          <div className="relative">
            <div className="font-mono text-4xl font-extrabold text-success truncate">
              +{totalRewardsHbar.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm font-medium text-success/80 mt-1">HBAR</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-border bg-card p-6 flex flex-col justify-between"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agents Backed</span>
          </div>
          <div>
             <div className="font-mono text-4xl font-extrabold text-foreground">
              {totalAgentsBacked}
            </div>
            <div className="text-sm font-medium text-muted-foreground mt-1">Active Positions</div>
          </div>
        </motion.div>
      </div>

      {/* Positions Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-3xl border border-border bg-card overflow-hidden shadow-sm"
      >
        <div className="p-6 md:p-8 border-b border-border flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-foreground">Active Stakes</h2>
            {isPortfolioLoading && selectedAccountId && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <button
            onClick={() => setShowStakeModal(true)}
            disabled={!selectedAccountId}
            className="w-full md:w-auto flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-transform hover:-translate-y-0.5 glow-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            <Plus className="h-4 w-4" /> New Stake Position
          </button>
        </div>

        <div className="overflow-x-auto">
          {!selectedAccountId ? (
             <div className="text-center py-16 px-4 flex flex-col items-center">
              <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Wallet className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Wallet Disconnected</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Connect your HashPack wallet to view your active staking positions and claim yield.
              </p>
            </div>
          ) : positionsList.length === 0 && !isPortfolioLoading ? (
            <div className="text-center py-16 px-4 flex flex-col items-center">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 border border-primary/20">
                <Users className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">No Active Stakes</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-6">
                You haven't backed any AI agents yet. Stake HBAR on top performers to start earning yield.
              </p>
              <Link
                href="/agents"
                className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors"
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
                {positionsList.map(([agentIdStr, pos], i) => {
                  const agentId = Number(agentIdStr);
                  const agent = agents.find(a => Number(a.id) === agentId);
                  const directoryMetadata = getAgentDirectoryEntry(agent?.name || String(agentId));
                  const avatar = directoryMetadata?.avatar || "🤖";

                  const amountHbar = Number(formatHbar(pos.stake.amount));
                  const rewardHbar = Number(formatHbar(pos.pendingReward));

                  return (
                    <motion.tr
                      key={agentId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.05 }}
                      className="group hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
                            {avatar}
                          </div>
                          <div>
                            <Link href={`/agent/${agentId}`} className="font-semibold text-foreground group-hover:text-primary transition-colors">
                              {agent?.name || `Agent #${agentId}`}
                            </Link>
                            <div className="text-[10px] text-muted-foreground mt-0.5">ID: #{agentId}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <div className="font-mono text-base font-bold text-foreground">{amountHbar.toLocaleString()}</div>
                        <div className="text-[10px] text-muted-foreground uppercase">HBar</div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <div className="font-mono text-base font-bold text-success">+{rewardHbar.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                        <div className="text-[10px] text-success/80 uppercase">HBar</div>
                      </td>
                      <td className="px-6 py-5 text-right">
                         <div className="flex items-center justify-end gap-2">
                          {rewardHbar > 0 && (
                            <button
                              onClick={() => handleClaim(agentId)}
                              disabled={isProcessing[`claim-${agentId}`] || isProcessing[`unstake-${agentId}`]}
                              className="inline-flex items-center rounded-lg bg-success/10 border border-success/30 px-4 py-2 text-xs font-bold text-success hover:bg-success/20 transition-colors disabled:opacity-50 min-w-[80px] justify-center"
                            >
                              {isProcessing[`claim-${agentId}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                              Claim
                            </button>
                          )}
                          <button
                            onClick={() => handleUnstake(agentId, pos.stake.amount)}
                            disabled={isProcessing[`unstake-${agentId}`]}
                            className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 min-w-[90px] justify-center"
                          >
                            {isProcessing[`unstake-${agentId}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : ""}
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

      <AnimatePresence>
        {showStakeModal && <StakingForm onClose={() => setShowStakeModal(false)} />}
      </AnimatePresence>
    </div>
    </TooltipProvider>
  );
}
