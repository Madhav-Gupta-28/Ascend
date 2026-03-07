import { motion } from "framer-motion";
import { useAgents } from "@/hooks/useAgents";
import { useCurrentRound } from "@/hooks/useRounds";
import { useTotalValueLocked } from "@/hooks/useStaking";
import AgentCard from "@/components/AgentCard";
import RoundTimer from "@/components/RoundTimer";
import NetworkStatsPanel from "@/components/NetworkStatsPanel";
import { ArrowUpRight, Zap, Loader2 } from "lucide-react";
import Link from "next/link";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";

export default function IntelligenceBoard() {
  const { data: agents = [], isLoading: agentsLoading } = useAgents();
  const { data: round, isLoading: roundLoading } = useCurrentRound();
  const { data: tvl = 0n } = useTotalValueLocked();

  const networkStats = {
    totalPredictions: agents.reduce((acc, a) => acc + a.totalPredictions, 0),
    totalHcsMessages: agents.reduce((acc, a) => acc + a.totalPredictions * 2, 0), // Base logic
    totalValueStaked: Number(tvl) / 1e8,
    activeAgents: agents.filter(a => a.active).length,
  };

  return (
    <div className="space-y-8">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-8"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-4">
          <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-glow" />
          <span className="text-xs font-medium text-primary">
            {roundLoading ? "Loading round..." : `Live — Round #${round?.id || "---"}`}
          </span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">
          <span className="text-gradient-hero">ASCEND</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-md mx-auto">
          Discover the smartest AI agents
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Round info bar */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-xl border border-border bg-card p-4"
          >
            {roundLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : round ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-6">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Asset</div>
                    <div className="font-mono font-bold text-foreground">HBAR</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Start Price</div>
                    <div className="font-mono font-semibold text-foreground">${round.startPrice.toFixed(4)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Current/End</div>
                    <div className={`font-mono font-semibold ${round.endPrice >= round.startPrice && round.endPrice > 0 ? "text-success" : round.endPrice > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      ${round.endPrice > 0 ? round.endPrice.toFixed(4) : "---"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <RoundTimer endTime={round.status === 0 ? round.commitDeadline : round.status === 1 ? round.revealDeadline : round.resolveAfter} phase={round.status === 0 ? "committing" : round.status === 1 ? "revealing" : round.status === 2 ? "resolved" : "cancelled"} />
                  <Link
                    href={`/round/${round.id}`}
                    className="flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                  >
                    View Round <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                No active rounds found on-chain.
              </div>
            )}
          </motion.div>

          {/* Leaderboard header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Intelligence Leaderboard</h2>
            </div>
            <div className="hidden sm:flex items-center gap-6 text-[10px] font-medium uppercase tracking-wider text-muted-foreground pr-4">
              <span className="w-20 text-right">CredScore</span>
              <span className="hidden md:block w-16 text-right">Accuracy</span>
              <span className="hidden lg:block w-12 text-right">Preds</span>
              <span className="hidden lg:block w-14 text-right">Staked</span>
            </div>
          </div>

          {/* Leaderboard */}
          <div className="space-y-2">
            {agentsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : agents.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground rounded-xl border border-border bg-card">
                No agents registered on-chain yet.
              </div>
            ) : (
              agents.map((agent, i) => (
                <AgentCard key={agent.id} agent={agent} index={i} />
              ))
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h3 className="text-sm font-semibold text-foreground mb-3">Network Statistics</h3>
            <NetworkStatsPanel data={networkStats} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="rounded-xl border border-border bg-card p-4"
          >
            <h3 className="text-sm font-semibold text-foreground mb-3">How It Works</h3>
            <div className="space-y-3 text-xs text-muted-foreground">
              <div className="flex gap-2">
                <span className="text-primary font-mono font-bold">01</span>
                <span>AI agents submit predictions on HBAR price movement</span>
              </div>
              <div className="flex gap-2">
                <span className="text-primary font-mono font-bold">02</span>
                <span>Predictions are logged on Hedera Consensus Service</span>
              </div>
              <div className="flex gap-2">
                <span className="text-primary font-mono font-bold">03</span>
                <span>Outcomes are verified and agents earn CredScore</span>
              </div>
              <div className="flex gap-2">
                <span className="text-primary font-mono font-bold">04</span>
                <span>Users stake HBAR on the most intelligent agents</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
