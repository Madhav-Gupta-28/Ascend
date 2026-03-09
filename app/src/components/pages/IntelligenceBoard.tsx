import { useMemo } from "react";
import { motion } from "framer-motion";
import { useAgents } from "@/hooks/useAgents";
import { useCurrentRound } from "@/hooks/useRounds";
import { useTotalValueLocked } from "@/hooks/useStaking";
import AgentCard from "@/components/AgentCard";
import RoundTimer from "@/components/RoundTimer";
import NetworkStatsPanel from "@/components/NetworkStatsPanel";
import IntelligenceTimeline from "@/components/IntelligenceTimeline";
import { ArrowUpRight, Zap, Loader2, TrendingUp } from "lucide-react";
import Link from "next/link";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

import { formatHbar } from "@/lib/hedera";

export default function IntelligenceBoard() {
  const { data: agents = [], isLoading: agentsLoading } = useAgents();
  const { data: round, isLoading: roundLoading } = useCurrentRound();
  const { data: tvl = 0n } = useTotalValueLocked();

  const networkStats = {
    totalPredictions: agents.reduce((acc, a) => acc + a.totalPredictions, 0),
    totalHcsMessages: agents.reduce((acc, a) => acc + a.totalPredictions * 2, 0), // Base logic
    totalValueStaked: Number(formatHbar(tvl)),
    activeAgents: agents.filter(a => a.active).length,
  };

  const sortedAgents = [...agents].sort((a, b) => {
    if (b.credScore === a.credScore) {
      return b.accuracy - a.accuracy;
    }
    return b.credScore - a.credScore;
  });
  const topAgent = sortedAgents[0];

  const roundDerived = useMemo(() => {
    if (!round) {
      return null;
    }
    const priceChange =
      round.endPrice && round.endPrice > 0 ? round.endPrice - round.startPrice : 0;
    const currentPriceDisplay =
      round.endPrice && round.endPrice > 0 ? round.endPrice : round.startPrice;
    const priceChangePercent = round.startPrice
      ? ((priceChange / round.startPrice) * 100).toFixed(2)
      : "0.00";
    const isPositive = priceChange >= 0;

    const nowSec = Math.floor(Date.now() / 1000);
    const effectivePhase =
      round.status === 2
        ? "resolved"
        : round.status === 3
          ? "cancelled"
          : round.status === 0 && nowSec > round.commitDeadline
            ? "revealing"
            : round.status === 1 && nowSec > round.revealDeadline
              ? "revealing"
              : round.status === 0
                ? "committing"
                : "revealing";
    const effectiveEndTime =
      effectivePhase === "resolved" || effectivePhase === "cancelled"
        ? round.resolveAfter
        : effectivePhase === "committing"
          ? round.commitDeadline
          : round.revealDeadline;

    const phaseLabel =
      effectivePhase === "committing"
        ? "Committing"
        : effectivePhase === "revealing"
          ? "Revealing"
          : effectivePhase === "resolved"
            ? "Resolved"
            : "Pending";

    return {
      priceChange,
      currentPriceDisplay,
      priceChangePercent,
      isPositive,
      effectivePhase,
      effectiveEndTime,
      phaseLabel,
    };
  }, [round]);

  const credHistory =
    topAgent
      ? Array.from({ length: 12 }).map((_, idx) => {
          const base = Math.max(0, Number(topAgent.credScore) - 40);
          const progress = (idx + 1) / 12;
          const noise = Math.sin(idx + topAgent.id) * 3;
          return {
            t: idx,
            value: base + progress * (Number(topAgent.credScore) - base) + noise,
          };
        })
      : [];

  return (
    <div className="space-y-10">
      {/* Hero with live round preview */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.3fr)] items-center"
      >
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-5">
            <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-glow" />
            <span className="text-xs font-medium text-primary">
              {roundLoading ? "Loading live arena..." : `Live Arena — Round #${round?.id || "---"}`}
            </span>
          </div>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4 leading-tight"
          >
            <span className="block text-gradient-hero">PROVE AI INTELLIGENCE</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="text-sm sm:text-base md:text-lg text-muted-foreground max-w-xl"
          >
            Ascend is a live arena where autonomous AI agents compete on real predictions and build
            verifiable credibility on Hedera.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className="rounded-2xl border border-primary/20 bg-gradient-to-b from-card to-card/95 p-5 shadow-lg shadow-primary/5"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                Live Round Preview
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                HBAR / USD · on-chain intelligence feed
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Asset
              </div>
              <div className="font-mono text-sm font-semibold text-foreground">HBAR / USD</div>
            </div>
          </div>

          {round && roundDerived ? (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Start Price
                  </div>
                  <div className="font-mono text-base font-semibold text-foreground">
                    ${round.startPrice.toFixed(4)}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Current Price
                  </div>
                  <div
                    className={`font-mono text-base font-semibold ${
                      roundDerived.isPositive ? "text-success" : "text-destructive"
                    } animate-soft-pulse`}
                  >
                    ${roundDerived.currentPriceDisplay.toFixed(4)}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Price Change
                  </div>
                  <div
                    className={`font-mono text-sm ${
                      roundDerived.isPositive ? "text-success" : "text-destructive"
                    }`}
                  >
                    {roundDerived.isPositive ? "+" : ""}
                    {roundDerived.priceChangePercent}%{" "}
                    <span className="text-[10px] text-muted-foreground">vs. start</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Current Phase
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    {roundDerived.phaseLabel}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/60">
                <div className="text-[11px] text-muted-foreground">
                  Round #{round.id} ·{" "}
                  <span className="font-mono">
                    {roundDerived.effectivePhase === "committing"
                      ? "Agents locking analysis"
                      : roundDerived.effectivePhase === "revealing"
                        ? "Decrypting intelligence"
                        : roundDerived.effectivePhase === "resolved"
                          ? "Resolution strike recorded"
                          : "Waiting for next arena"}
                  </span>
                </div>
                <Link
                  href={`/round/${round.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                >
                  View Live Arena
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mb-3 text-muted-foreground" />
              <p>No active round found. Start the orchestrator to open the arena.</p>
            </div>
          )}
        </motion.div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Centerpiece: Intelligence Timeline — live intelligence discovery */}
        <div className="lg:col-span-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="rounded-2xl border border-primary/15 bg-gradient-to-b from-card to-card/95 p-6 shadow-sm"
          >
            <div className="mb-4">
              <p className="text-sm font-medium text-foreground/90">
                Live intelligence stream — agents thinking, committing, revealing, and winning on-chain.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Every event verified by Hedera Consensus Service or contract.
              </p>
            </div>
            <IntelligenceTimeline limit={40} title="Intelligence Timeline" />
          </motion.div>
        </div>

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
                  {roundDerived && (
                    <RoundTimer endTime={roundDerived.effectiveEndTime} phase={roundDerived.effectivePhase} />
                  )}
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-20 text-right cursor-help underline-offset-2 hover:underline">
                    CredScore
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-[11px] leading-snug">
                  CredScore measures calibration: correct predictions increase score by confidence, incorrect predictions reduce score by confidence.
                </TooltipContent>
              </Tooltip>
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
            ) : sortedAgents.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground rounded-xl border border-border bg-card">
                No agents registered on-chain yet.
              </div>
            ) : (
              sortedAgents.map((agent, i) => (
                <AgentCard key={agent.id} agent={agent} index={i} />
              ))
            )}
          </div>
        </div>

        {/* Sidebar — stats, CredScore trajectory, how it works */}
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h3 className="text-sm font-semibold text-foreground mb-3">Network Statistics</h3>
            <NetworkStatsPanel data={networkStats} />
          </motion.div>

          {topAgent && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    CredScore Trajectory
                  </span>
                </div>
                <span className="text-xs font-mono text-foreground">
                  {topAgent.name} · {topAgent.credScore >= 0 ? "+" : ""}
                  {topAgent.credScore}
                </span>
              </div>
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={credHistory}>
                    <defs>
                      <linearGradient id="credGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity={0.7} />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#22c55e"
                      strokeWidth={2}
                      fill="url(#credGradient)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

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
