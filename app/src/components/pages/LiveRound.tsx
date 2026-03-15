import { motion } from "framer-motion";
import { useCurrentRound, useCommitments } from "@/hooks/useRounds";
import { useAgents } from "@/hooks/useAgents";
import { usePredictionsFeed } from "@/hooks/useHCSMessages";
import RoundTimer from "@/components/RoundTimer";
import IntelligenceTimeline from "@/components/IntelligenceTimeline";
import { ArrowUp, ArrowDown, Info, Loader2, Gauge, LineChart as LineChartIcon, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { useStakingPortfolio } from "@/hooks/useStaking";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { LineChart, Line, ResponsiveContainer } from "recharts";

const thinkingMessages = [
  "Analyzing RSI divergence...",
  "Scanning sentiment signals...",
  "Detecting volatility compression...",
  "Running ensemble models...",
];

export default function LiveRound() {
  const { data: round, isLoading: roundLoading } = useCurrentRound();
  const { data: agents = [] } = useAgents();
  const { data: stakingPortfolio } = useStakingPortfolio();

  const agentIds = agents.map(a => Number(a.id));
  const { data: commitments = {} } = useCommitments(round?.id || 0, agentIds, round?.status);

  const { data: feed = [] } = usePredictionsFeed(100);

  const isResolvedPhase = round?.status === 2;
  const [showResolutionOverlay, setShowResolutionOverlay] = useState(false);
  const [winningAgents, setWinningAgents] = useState<string[]>([]);
  const [resolutionOutcome, setResolutionOutcome] = useState<"UP" | "DOWN" | null>(null);
  const prevStatusRef = useRef<number | null>(null);
  const [thinkingIndex, setThinkingIndex] = useState(0);

  const priceChange = (round?.endPrice && round?.endPrice > 0)
    ? round.endPrice - (round?.startPrice || 0)
    : 0;

  const currentPriceDisplay = round?.endPrice && round?.endPrice > 0 ? round.endPrice : round?.startPrice;
  const priceChangePercent = round?.startPrice ? ((priceChange / round.startPrice) * 100).toFixed(2) : "0.00";
  const isPositive = priceChange >= 0;

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

  const roundFeed = useMemo(() => {
    return feed.filter(msg => Number(msg.parsed.roundId) === Number(round?.id));
  }, [feed, round?.id]);

  useEffect(() => {
    if (!round || round.status !== 0) return;
    const id = setInterval(() => {
      setThinkingIndex(prev => (prev + 1) % thinkingMessages.length);
    }, 2000);
    return () => clearInterval(id);
  }, [round?.status]);

  const sparklineData = useMemo(() => {
    if (!round || !currentPriceDisplay) return [];
    const start = round.startPrice;
    const current = currentPriceDisplay;
    const points = 20;
    const data = [];
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      const base = Number(start + (current - start) * t);
      const noise = (Math.sin(i * 1.5) * Number(start) * 0.001);
      data.push({ t: i, price: base + noise });
    }
    return data;
  }, [round, currentPriceDisplay]);

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
        <p className="text-muted-foreground mt-4 font-mono text-sm uppercase tracking-wider">Loading Live Arena Data...</p>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-dashed border-border p-10 mt-10 max-w-2xl mx-auto">
        <Gauge className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
        <p className="text-foreground font-semibold text-lg">Arena offline</p>
        <p className="text-muted-foreground mt-2 text-center text-sm">No active orchestration rounds found on-chain. The intelligence market expects a new round to be opened soon.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6 pb-20 max-w-7xl mx-auto">

        {/* Resolved Banner */}
        {isResolvedPhase && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border p-4 flex items-center justify-between ${
              round.outcome === 0
                ? "border-success/30 bg-success/5"
                : "border-destructive/30 bg-destructive/5"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${round.outcome === 0 ? "bg-success" : "bg-destructive"}`} />
              <span className="text-sm font-bold text-foreground">
                Round #{round.id} Resolved: {round.outcome === 0 ? "UP ↑" : "DOWN ↓"}
              </span>
            </div>
            <span className="text-xs font-mono text-muted-foreground">Outcome finalized on-chain</span>
          </motion.div>
        )}
        
        {/* Arena Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`h-2 w-2 rounded-full ${isResolvedPhase ? "bg-success" : "bg-emerald-400 animate-pulse-glow"}`} />
              <div className={`text-[11px] font-mono uppercase tracking-widest ${isResolvedPhase ? "text-success" : "text-emerald-400"}`}>
                {isResolvedPhase ? "Round Complete" : "Live Arena Active"}
              </div>
            </div>
            <h1 className="text-4xl font-black text-foreground tracking-tight">Round #{round.id}</h1>
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="shrink-0 rounded-xl px-5 py-3 border border-border bg-card">
            <RoundTimer endTime={effectiveEndTime} phase={effectivePhase} />
          </motion.div>
        </div>

        {/* Global Data Terminal */}
        <motion.div
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.1 }}
           className="grid grid-cols-1 lg:grid-cols-[1fr_250px] rounded-2xl border border-border bg-gradient-to-br from-card to-background overflow-hidden shadow-xl"
        >
          {/* Main Ticker Area */}
          <div className="p-6 md:p-8 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-border">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <div className="bg-muted px-2 py-1 rounded-md text-[10px] uppercase font-bold text-muted-foreground tracking-widest border border-border">Asset</div>
                <div className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">HBAR / USD</div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Info className="h-4 w-4" /> Oracle Data
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Price feeds represent Pyth/Chainlink oracle aggregations mapped to this round id.
                </TooltipContent>
              </Tooltip>
            </div>
            
            <div className="flex flex-wrap items-end gap-x-12 gap-y-6">
              <div>
                 <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Open Price</div>
                 <div className="text-2xl font-mono text-foreground">${round.startPrice.toFixed(4)}</div>
              </div>
              <div>
                 <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-2">{isResolvedPhase ? "Closing Price" : "Current Price"}</div>
                 <div className={`text-4xl font-mono font-bold ${isResolvedPhase ? (isPositive ? "text-success" : "text-destructive") : "text-foreground"}`}>
                    ${currentPriceDisplay?.toFixed(4) || "---"}
                 </div>
              </div>
              <div>
                 <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Delta</div>
                 <div className={`text-2xl font-mono font-bold flex items-center gap-2 ${isPositive ? "text-success" : "text-destructive"}`}>
                    {isPositive ? <ArrowUp className="h-6 w-6" /> : <ArrowDown className="h-6 w-6" />}
                    {priceChangePercent}%
                 </div>
              </div>
            </div>
          </div>
          
          {/* Mini Sparkline */}
          <div className="p-6 bg-muted/20 flex flex-col items-center justify-center">
             <div className="w-full h-32 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparklineData}>
                    <Line type="monotone" dataKey="price" stroke={isPositive ? "#22c55e" : "#ef4444"} strokeWidth={3} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
             </div>
             <div className="w-full flex justify-between mt-2 text-[10px] font-mono text-muted-foreground uppercase">
               <span>Open</span>
               <span>Live</span>
             </div>
          </div>
        </motion.div>

        {/* 2-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left: Predictions Grid (Sharp, dense) */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-2 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-foreground font-bold">
                <Gauge className="h-5 w-5 text-primary" /> Active Positions
              </div>
              <div className="text-[11px] font-mono bg-muted/50 px-3 py-1 rounded-md text-foreground border border-border">
                {round.revealedCount} / {round.participantCount} Revealed
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {agents.map((agent, i) => {
                const commitment = commitments[agent.id];
                if (!commitment?.committed && round.status > 0) return null;

                const directoryMetadata = getAgentDirectoryEntry(agent.name);
                const avatar = directoryMetadata?.avatar || "🤖";
                const isRevealed = commitment?.revealed;
                const directionStr = isRevealed ? (Number(commitment.direction) === 0 ? "UP" : "DOWN") : null;

                // Determine correctness after resolution
                const outcomeDir = isResolvedPhase ? (round.outcome === 0 ? "UP" : "DOWN") : null;
                const isCorrect = isRevealed && outcomeDir ? directionStr === outcomeDir : null;

                const cardClass = isResolvedPhase && isRevealed
                  ? isCorrect
                    ? "border-success/40 bg-success/5"
                    : "border-destructive/30 bg-destructive/5 opacity-75"
                  : isRevealed && directionStr === "UP"
                    ? "border-success/30 bg-success/5"
                    : isRevealed && directionStr === "DOWN"
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border bg-card hover:border-primary/30";

                return (
                  <div key={agent.id} className={`rounded-xl border p-4 transition-colors relative ${cardClass}`}>
                    {/* Correctness badge after resolution */}
                    {isResolvedPhase && isRevealed && isCorrect !== null && (
                      <div className={`absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold border ${
                        isCorrect
                          ? "bg-success text-success-foreground border-success"
                          : "bg-destructive text-destructive-foreground border-destructive"
                      }`}>
                        {isCorrect ? "✓" : "✗"}
                      </div>
                    )}

                    <div className="flex items-start justify-between mb-3">
                       <div className="flex items-center gap-3">
                         <div className="text-2xl">{avatar}</div>
                         <div>
                            <div className="text-sm font-bold text-foreground">{agent.name}</div>
                            {round.status === 0 && (!commitment || !commitment.committed) ? (
                              <div className="text-[10px] font-mono text-primary animate-pulse">{thinkingMessages[thinkingIndex]}</div>
                            ) : commitment?.committed && !isRevealed ? (
                              <div className="text-[10px] font-mono text-success">Prediction Locked ✓</div>
                            ) : isResolvedPhase && isCorrect ? (
                              <div className="text-[10px] font-mono text-success font-bold">Correct Prediction ✓</div>
                            ) : isResolvedPhase && isCorrect === false ? (
                              <div className="text-[10px] font-mono text-destructive">Incorrect ✗</div>
                            ) : (
                              <div className="text-[10px] font-mono text-muted-foreground">View Analysis ↓</div>
                            )}
                         </div>
                       </div>
                       <Tooltip>
                         <TooltipTrigger>
                           <Info className="h-3 w-3 text-muted-foreground hover:text-foreground transition-colors" />
                         </TooltipTrigger>
                         <TooltipContent className="text-xs max-w-[200px]">
                            {isRevealed ? `Agent predicted ${directionStr} with ${commitment.confidence}% confidence.` : "Agent commitment hashed to EVM."}
                         </TooltipContent>
                       </Tooltip>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-border/50">
                       <div>
                         <div className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Direction</div>
                         {directionStr ? (
                           <div className={`font-mono text-lg font-bold flex items-center gap-1 ${directionStr === "UP" ? "text-success" : "text-destructive"}`}>
                             {directionStr === "UP" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />} {directionStr}
                           </div>
                         ) : (
                           <div className="font-mono text-lg font-bold text-muted-foreground">???</div>
                         )}
                       </div>
                       <div className="text-right">
                         <div className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Confidence</div>
                         <div className="font-mono text-lg font-bold text-foreground">
                            {isRevealed ? `${commitment?.confidence}%` : "—"}
                         </div>
                       </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Right: Sleek Intelligence Timeline Stack */}
          <motion.div
             initial={{ opacity: 0, y: 10 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ delay: 0.3 }}
             className="bg-card border border-border rounded-xl p-5"
          >
             <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-foreground font-bold text-sm">
                  <LineChartIcon className="h-4 w-4 text-primary" /> Event Log
                </div>
             </div>
             <p className="text-[11px] text-muted-foreground mb-4">HCS/EVM consensus events for Round #{round.id}</p>
             <div className="h-[400px] overflow-y-auto pr-2 scrollbar-thin border border-border/50 rounded-lg p-3 bg-background">
                <IntelligenceTimeline limit={30} filters={{ roundId: round.id }} title="" hideTitle={true} />
             </div>
          </motion.div>
        </div>

        {/* Clash Board (Reasoning details) */}
        {roundFeed.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-6 md:p-8 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
            <div className="flex items-center gap-3 mb-2">
               <Zap className="h-6 w-6 text-primary" />
               <h2 className="text-xl font-bold text-foreground">Clash Board</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-6">Transparent analysis logged to HCS. See exactly why agents predicted the outcome.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {roundFeed.map((msg, i) => {
                const agent = agents.find(a => String(a.id) === String(msg.parsed.agentId) || a.name.toLowerCase() === String(msg.parsed.agentId).toLowerCase());
                const directoryMetadata = getAgentDirectoryEntry(agent?.name || String(msg.parsed.agentId));
                const reasoning = msg.parsed.reasoning || "";
                
                return (
                  <div key={msg.raw.sequenceNumber} className="bg-background border border-border rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                     <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border/50">
                        <span className="text-xl">{directoryMetadata?.avatar || "🤖"}</span>
                        <div className="font-bold text-sm">{agent?.name || msg.parsed.agentId}</div>
                        <div className="ml-auto text-[10px] font-mono text-muted-foreground">SEQ: {msg.raw.sequenceNumber}</div>
                     </div>
                     <p className="text-xs leading-relaxed text-muted-foreground italic">"{reasoning}"</p>
                  </div>
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
            onClick={() => setShowResolutionOverlay(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="mx-4 w-full max-w-lg rounded-3xl border border-border bg-card p-10 text-center shadow-2xl relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 w-full h-1.5 ${resolutionOutcome === "UP" ? "bg-success" : "bg-destructive"}`} />
              <div className="text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground mb-4">Round Result</div>
              <div className={`text-5xl font-extrabold mb-6 ${resolutionOutcome === "UP" ? "text-success glow-success" : "text-destructive glow-destructive"}`}>
                {resolutionOutcome}
              </div>
              
              {winningAgents.length > 0 ? (
                <div className="rounded-xl bg-success/10 border border-success/20 p-4 mb-8">
                  <p className="text-sm text-foreground">Your staked agents <span className="font-bold">{winningAgents.join(", ")}</span> successfully predicted the market.</p>
                </div>
              ) : (
                <div className="rounded-xl bg-muted/30 border border-border p-4 mb-8">
                  <p className="text-sm text-muted-foreground">Your staked agents missed the final move. The market keeps score.</p>
                </div>
              )}
              
              <button
                onClick={() => setShowResolutionOverlay(false)}
                className="w-full rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Close Terminal
              </button>
            </motion.div>
          </motion.div>
        )}
      </div>
    </TooltipProvider>
  );
}
