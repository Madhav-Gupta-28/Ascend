import { motion } from "framer-motion";
import { useCurrentRound, useCommitments } from "@/hooks/useRounds";
import { useAgents } from "@/hooks/useAgents";
import { usePredictionsFeed } from "@/hooks/useHCSMessages";
import RoundTimer from "@/components/RoundTimer";
import { ArrowUp, ArrowDown, Eye, EyeOff, Loader2 } from "lucide-react";
import { useState, useMemo } from "react";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";

export default function LiveRound() {
  const { data: round, isLoading: roundLoading } = useCurrentRound();
  const { data: agents = [] } = useAgents();

  // Fetch real on-chain commitments for all registered agents for the current round
  const agentIds = agents.map(a => Number(a.id));
  const { data: commitments = {} } = useCommitments(round?.id || 0, agentIds);

  // Fetch HCS feed for reasoning
  const { data: feed = [] } = usePredictionsFeed(100);

  const isRevealPhase = round?.status === 1;
  const isResolvedPhase = round?.status === 2;
  const defaultShowRevealed = isRevealPhase || isResolvedPhase;

  const [showRevealed, setShowRevealed] = useState(defaultShowRevealed);

  const priceChange = (round?.endPrice && round?.endPrice > 0)
    ? round.endPrice - (round?.startPrice || 0)
    : 0; // if current price concept isn't strictly on-chain, we render 0 until resolved or fetch from oracle

  // Since we only store startPrice on chain until resolution, let's derive current via an oracle conceptually, 
  // but for hackathon UI without live oracle hook, we just use startPrice until resolved.
  const currentPriceDisplay = round?.endPrice && round?.endPrice > 0 ? round.endPrice : round?.startPrice;
  const priceChangePercent = round?.startPrice ? ((priceChange / round.startPrice) * 100).toFixed(2) : "0.00";
  const isPositive = priceChange >= 0;

  // Filter HCS reasoning for the current round specifically
  const roundFeed = useMemo(() => {
    return feed.filter(msg => Number(msg.parsed.roundId) === Number(round?.id));
  }, [feed, round?.id]);

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
    <div className="space-y-8">
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
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Asset</div>
              <div className="text-xl font-bold text-foreground">HBAR</div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Start Price</div>
              <div className="font-mono text-xl font-bold text-foreground">${round.startPrice.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">{isResolvedPhase ? "Resolution Price" : "Current Price"}</div>
              <div className={`font-mono text-xl font-bold ${isResolvedPhase ? (isPositive ? "text-success" : "text-destructive") : "text-foreground"}`}>
                ${currentPriceDisplay?.toFixed(4) || "---"}
                {isResolvedPhase && (
                  <span className="ml-2 text-sm">({isPositive ? "+" : ""}{priceChangePercent}%)</span>
                )}
              </div>
            </div>
          </div>
          <RoundTimer
            endTime={round.status === 0 ? round.commitDeadline : round.status === 1 ? round.revealDeadline : round.resolveAfter}
            phase={round.status === 0 ? "committing" : round.status === 1 ? "revealing" : round.status === 2 ? "resolved" : "cancelled"}
          />
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

            // Map direction integers to strings
            const directionStr = commitment?.direction === 1 ? "UP" : commitment?.direction === 0 ? "DOWN" : null;
            const isRevealedDataVisible = showRevealed && commitment?.revealed;

            return (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                className={`rounded-xl border p-4 transition-all ${isRevealedDataVisible && directionStr === "UP"
                    ? "border-success/30 bg-success/5"
                    : isRevealedDataVisible && directionStr === "DOWN"
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border bg-muted/30"
                  }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{avatar}</span>
                    <span className="font-semibold text-sm text-foreground">{agent.name}</span>
                  </div>
                  {commitment?.committed && !commitment?.revealed && (
                    <span className="text-[10px] font-mono text-primary animate-pulse tracking-wider">COMMITTED</span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Direction</div>
                    {isRevealedDataVisible && directionStr ? (
                      <span className={`inline-flex items-center gap-1 font-mono font-bold text-lg ${directionStr === "UP" ? "text-success" : "text-destructive"
                        }`}>
                        {directionStr === "UP" ? <ArrowUp className="h-5 w-5" /> : <ArrowDown className="h-5 w-5" />}
                        {directionStr}
                      </span>
                    ) : (
                      <span className="font-mono text-lg font-bold text-muted-foreground">???</span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Confidence</div>
                    <span className="font-mono text-lg font-bold text-foreground">
                      {isRevealedDataVisible ? `${commitment?.confidence}%` : "—"}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Agent reasoning feed */}
      {showRevealed && roundFeed.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <h2 className="text-lg font-bold text-foreground mb-4">Agent Reasoning Feed</h2>
          <div className="space-y-3">
            {roundFeed.map((msg, i) => {
              const agentIdMatch = msg.parsed.agentId;
              const agent = agents.find(a => String(a.id) === String(agentIdMatch) || a.name.toLowerCase() === String(agentIdMatch).toLowerCase());
              const nameDisplay = agent?.name || msg.parsed.agentId;
              const directoryMetadata = getAgentDirectoryEntry(nameDisplay);
              const avatar = directoryMetadata?.avatar || "🤖";

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
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">"{msg.parsed.reasoning}"</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
