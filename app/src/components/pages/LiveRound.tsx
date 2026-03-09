import { motion } from "framer-motion";
import { useCurrentRound, useCommitments } from "@/hooks/useRounds";
import { useAgents } from "@/hooks/useAgents";
import { usePredictionsFeed } from "@/hooks/useHCSMessages";
import RoundTimer from "@/components/RoundTimer";
import IntelligenceTimeline from "@/components/IntelligenceTimeline";
import { ArrowUp, ArrowDown, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { useStakingPortfolio } from "@/hooks/useStaking";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

export default function LiveRound() {
  const { data: round, isLoading: roundLoading } = useCurrentRound();
  const { data: agents = [] } = useAgents();
  const { data: stakingPortfolio } = useStakingPortfolio();

  // Fetch real on-chain commitments for all registered agents for the current round
  const agentIds = agents.map(a => Number(a.id));
  const { data: commitments = {} } = useCommitments(round?.id || 0, agentIds, round?.status);

  // Fetch HCS feed for reasoning
  const { data: feed = [] } = usePredictionsFeed(100);

  const isRevealPhase = round?.status === 1;
  const isResolvedPhase = round?.status === 2;
  const defaultShowRevealed = isRevealPhase || isResolvedPhase;

  const [showRevealed, setShowRevealed] = useState(defaultShowRevealed);
  const [showResolutionOverlay, setShowResolutionOverlay] = useState(false);
  const [winningAgents, setWinningAgents] = useState<string[]>([]);
  const [resolutionOutcome, setResolutionOutcome] = useState<"UP" | "DOWN" | null>(null);
  const prevStatusRef = useRef<number | null>(null);

  const priceChange = (round?.endPrice && round?.endPrice > 0)
    ? round.endPrice - (round?.startPrice || 0)
    : 0; // if current price concept isn't strictly on-chain, we render 0 until resolved or fetch from oracle

  // Since we only store startPrice on chain until resolution, let's derive current via an oracle conceptually, 
  // but for hackathon UI without live oracle hook, we just use startPrice until resolved.
  const currentPriceDisplay = round?.endPrice && round?.endPrice > 0 ? round.endPrice : round?.startPrice;
  const priceChangePercent = round?.startPrice ? ((priceChange / round.startPrice) * 100).toFixed(2) : "0.00";
  const isPositive = priceChange >= 0;

  // Effective phase and timer: if commit deadline passed but status still Committing, show Revealing and count down to reveal
  const nowSec = typeof round !== "undefined" ? Math.floor(Date.now() / 1000) : 0;
  const effectivePhase =
    round?.status === 2
      ? "resolved"
      : round?.status === 3
        ? "cancelled"
        : round?.status === 0 && nowSec > (round?.commitDeadline ?? 0)
          ? "revealing"
          : round?.status === 1 && nowSec > (round?.revealDeadline ?? 0)
            ? "revealing"
            : round?.status === 0
              ? "committing"
              : "revealing";
  const effectiveEndTime =
    effectivePhase === "resolved" || effectivePhase === "cancelled"
      ? (round?.resolveAfter ?? 0)
      : effectivePhase === "committing"
        ? (round?.commitDeadline ?? 0)
        : (round?.revealDeadline ?? 0);

  // Filter HCS reasoning for the current round specifically
  const roundFeed = useMemo(() => {
    return feed.filter(msg => Number(msg.parsed.roundId) === Number(round?.id));
  }, [feed, round?.id]);

  // Derive latest reasoning per agent for Clash Board
  const clashHighlights = useMemo(() => {
    const latestByAgent: Record<string, string> = {};
    for (const msg of roundFeed) {
      const agentId = String(msg.parsed.agentId ?? "").trim();
      if (!agentId) continue;
      const reasoning: string = msg.parsed.reasoning || "";
      if (!reasoning) continue;
      const firstSentence = reasoning.split(/(?<=[.!?])\s+/)[0];
      latestByAgent[agentId] = firstSentence;
    }
    return latestByAgent;
  }, [roundFeed]);

  // Detect transition to resolved round for winner moment + emotional feedback
  useEffect(() => {
    if (!round) return;
    const prev = prevStatusRef.current;
    const currentStatus = round.status;
    prevStatusRef.current = currentStatus;

    if (prev !== 2 && currentStatus === 2) {
      const outcomeDir: "UP" | "DOWN" = round.outcome === 0 ? "UP" : "DOWN";
      setResolutionOutcome(outcomeDir);

      const winners: string[] = [];
      const stakedAgentIds = stakingPortfolio ? Object.keys(stakingPortfolio.positions).map((id) => Number(id)) : [];

      agents.forEach((agent) => {
        const c = (commitments as any)[agent.id];
        if (!c?.revealed) return;
        const predictedDir: "UP" | "DOWN" | null =
          Number(c.direction) === 0 ? "UP" : Number(c.direction) === 1 ? "DOWN" : null;
        const hasStake = stakedAgentIds.includes(Number(agent.id));
        if (predictedDir && predictedDir === outcomeDir && hasStake) {
          winners.push(agent.name);
        }
      });

      setWinningAgents(winners);
      setShowResolutionOverlay(true);

      if (winners.length > 0) {
        toast.success(`Round resolved ${outcomeDir}. Your stake followed ${winners.join(", ")} and earned yield.`, {
          id: "round-resolution",
        });
      } else if (stakingPortfolio && Object.keys(stakingPortfolio.positions).length > 0) {
        toast(`Round resolved ${outcomeDir}. Your staked agents missed this one.`, { id: "round-resolution" });
      }
    }
  }, [round, agents, commitments, stakingPortfolio]);

  if (roundLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4">Loading Live Round from Hedera...</p>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">No active rounds found on-chain</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-8 relative">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-foreground mb-1">Live Round #{round.id}</h1>
          <p className="text-sm text-muted-foreground">Watch AI agents compete in real-time</p>
        </motion.div>

        {/* Round info */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-8">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">HBAR / USD</div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground"
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-[11px] leading-snug">
                      Price data is derived from the configured HBAR/USD feed for this demo round. Resolution uses
                      the final recorded price on-chain.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="text-xl font-bold text-foreground">HBAR</div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Start Price</div>
                <div className="font-mono text-xl font-bold text-foreground">${round.startPrice.toFixed(4)}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  {isResolvedPhase ? "Resolution Price" : "Current Price"}
                </div>
                <div
                  className={`font-mono text-xl font-bold ${
                    isResolvedPhase ? (isPositive ? "text-success" : "text-destructive") : "text-foreground"
                  } animate-soft-pulse`}
                >
                  ${currentPriceDisplay?.toFixed(4) || "---"}
                  {isResolvedPhase && (
                    <span className="ml-2 text-sm">
                      ({isPositive ? "+" : ""}
                      {priceChangePercent}%)
                    </span>
                  )}
                </div>
              </div>
            </div>
            <RoundTimer endTime={effectiveEndTime} phase={effectivePhase} />
          </div>

          {/* Explicit market movement summary for demo clarity */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-mono text-muted-foreground">
            <span className="uppercase tracking-wider text-[11px] text-foreground/80">HBAR / USD</span>
            <span>Start: ${round.startPrice.toFixed(4)}</span>
            <span>
              {isResolvedPhase ? "Final" : "Current"}: ${currentPriceDisplay?.toFixed(4) || "---"}
            </span>
            <span className={isPositive ? "text-success" : "text-destructive"}>
              Change: {isPositive ? "+" : ""}
              {priceChangePercent}%
            </span>
            {isResolvedPhase && (
              <span className={`font-semibold ${isPositive ? "text-success" : "text-destructive"}`}>
                HBAR moved {isPositive ? "UP" : "DOWN"}
              </span>
            )}
          </div>
        </motion.div>

        {/* Prediction grid */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-foreground">Agent Predictions</h2>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-mono font-medium text-muted-foreground border border-border">
                {round.revealedCount} / {round.participantCount} Revealed
              </span>
            </div>
            <button
              onClick={() => setShowRevealed(!showRevealed)}
              className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showRevealed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {showRevealed ? "Revealed" : "Hidden"}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {agents.map((agent, i) => {
              const commitment = commitments[agent.id];
              // If they haven't committed, and the round is committing, they might still commit
              if (!commitment?.committed && round.status > 0) return null; // Didn't participate

              const directoryMetadata = getAgentDirectoryEntry(agent.name);
              const avatar = directoryMetadata?.avatar || "🤖";
              const nameToStrategy: Record<string, string> = {
                sentinel: "Technical Analysis",
                pulse: "Sentiment",
                meridian: "Mean Reversion",
                oracle: "Meta-AI",
              };
              const strategy =
                nameToStrategy[agent.name.toLowerCase()] || "AI Strategy";

              // Contract: Direction.UP = 0, Direction.DOWN = 1
              const directionStr = commitment?.revealed
                ? Number(commitment.direction) === 0
                  ? "UP"
                  : Number(commitment.direction) === 1
                    ? "DOWN"
                    : null
                : null;
              const isRevealedDataVisible = showRevealed && commitment?.revealed;

              const cardGlowClass =
                isRevealedDataVisible && directionStr === "UP"
                  ? "border-success/40 bg-success/5 shadow-[0_0_30px_rgba(34,197,94,0.35)]"
                  : isRevealedDataVisible && directionStr === "DOWN"
                    ? "border-destructive/40 bg-destructive/5 shadow-[0_0_30px_rgba(239,68,68,0.35)]"
                    : "border-border bg-muted/30";

              return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{
                    opacity: 1,
                    scale: isRevealedDataVisible ? 1.02 : 1,
                  }}
                  transition={{ delay: 0.25 + i * 0.06, type: "spring", stiffness: 200, damping: 20 }}
                  className={`rounded-xl border p-4 transition-all ${cardGlowClass}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{avatar}</span>
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm text-foreground">{agent.name}</span>
                        <span className="mt-0.5 inline-flex items-center rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {strategy}
                        </span>
                      </div>
                    </div>
                    {commitment?.committed && !commitment?.revealed && (
                      <span className="text-[10px] font-mono text-primary animate-pulse tracking-wider">
                        Prediction locked
                      </span>
                    )}
                    {round.status === 0 && (!commitment || !commitment.committed) && (
                      <span className="text-[10px] font-mono text-muted-foreground tracking-wider">Waiting…</span>
                    )}
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                          Direction
                        </div>
                        {isRevealedDataVisible && directionStr ? (
                          <span
                            className={`inline-flex items-center gap-1 font-mono font-bold text-lg ${
                              directionStr === "UP" ? "text-success" : "text-destructive"
                            }`}
                          >
                            {directionStr === "UP" ? (
                              <ArrowUp className="h-5 w-5" />
                            ) : (
                              <ArrowDown className="h-5 w-5" />
                            )}
                            {directionStr}
                          </span>
                        ) : (
                          <span className="font-mono text-lg font-bold text-muted-foreground">???</span>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                          Confidence
                        </div>
                        <span className="font-mono text-lg font-bold text-foreground">
                          {isRevealedDataVisible ? `${commitment?.confidence}%` : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* Round-scoped Intelligence Timeline — same beautiful feed */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="rounded-2xl border border-primary/15 bg-gradient-to-b from-card to-card/95 p-6 shadow-sm"
        >
          <div className="mb-4">
            <p className="text-sm font-medium text-foreground/90">
              Commit and reveal events for this round — verified on Hedera.
            </p>
          </div>
          <IntelligenceTimeline
            limit={50}
            filters={{ roundId: round.id }}
            title={`Round #${round.id} — Timeline`}
          />
        </motion.div>

        {/* Clash Board — Agent reasoning highlights */}
        {showRevealed && roundFeed.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="rounded-2xl border border-border bg-card p-6"
          >
            <h2 className="text-lg font-bold text-foreground mb-1">Clash Board — Agent Reasoning Highlights</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Snapshot of how each agent interprets the same market at this moment.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {roundFeed.map((msg, i) => {
                const agentIdMatch = msg.parsed.agentId;
                const agent = agents.find(
                  a =>
                    String(a.id) === String(agentIdMatch) ||
                    a.name.toLowerCase() === String(agentIdMatch).toLowerCase(),
                );
                const nameDisplay = agent?.name || msg.parsed.agentId;
                const directoryMetadata = getAgentDirectoryEntry(nameDisplay);
                const avatar = directoryMetadata?.avatar || "🤖";
                const reasoning: string = msg.parsed.reasoning || "";
                const firstSentence = reasoning.split(/(?<=[.!?])\s+/)[0] || reasoning;

                return (
                  <motion.div
                    key={msg.raw.sequenceNumber}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + i * 0.08 }}
                    className="flex gap-3 rounded-xl border border-border bg-muted/30 p-4"
                  >
                    <span className="text-lg mt-0.5">{avatar}</span>
                    <div>
                      <span className="text-sm font-semibold text-foreground">{nameDisplay}</span>
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">"{firstSentence}"</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Resolution strike overlay */}
        {showResolutionOverlay && resolutionOutcome && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowResolutionOverlay(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="mx-4 max-w-xl rounded-3xl border border-primary/40 bg-gradient-to-b from-background to-background/90 px-8 py-10 text-center shadow-2xl"
            >
              <div className="text-[11px] font-mono uppercase tracking-[0.25em] text-primary mb-3">
                Resolution Strike
              </div>
              <div className="text-3xl md:text-4xl font-extrabold text-foreground mb-4">
                Round #{round.id} Resolved {resolutionOutcome}
              </div>
              {winningAgents.length > 0 ? (
                <p className="text-sm text-muted-foreground mb-6">
                  Your staked agents{" "}
                  <span className="font-semibold text-foreground">
                    {winningAgents.join(", ")}
                  </span>{" "}
                  were on the right side of the market.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mb-6">
                  This time, your staked agents missed the final move. The intelligence market keeps score.
                </p>
              )}
              <button
                onClick={() => setShowResolutionOverlay(false)}
                className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Continue
              </button>
            </motion.div>
          </motion.div>
        )}
      </div>
    </TooltipProvider>
  );
}
