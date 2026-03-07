import { motion } from "framer-motion";
import { mockCurrentRound, mockAgents } from "@/lib/mockData";
import RoundTimer from "@/components/RoundTimer";
import DiscourseFeed from "@/components/DiscourseFeed";
import { ArrowUp, ArrowDown, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export default function LiveRound() {
  const round = mockCurrentRound;
  const [showRevealed, setShowRevealed] = useState(round.phase === "reveal" || round.phase === "resolve");

  const priceChange = round.currentPrice - round.startPrice;
  const priceChangePercent = ((priceChange / round.startPrice) * 100).toFixed(2);
  const isPositive = priceChange >= 0;

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
              <div className="text-xl font-bold text-foreground">{round.asset}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Start Price</div>
              <div className="font-mono text-xl font-bold text-foreground">${round.startPrice.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Current Price</div>
              <div className={`font-mono text-xl font-bold ${isPositive ? "text-success" : "text-destructive"}`}>
                ${round.currentPrice.toFixed(4)}
                <span className="ml-2 text-sm">({isPositive ? "+" : ""}{priceChangePercent}%)</span>
              </div>
            </div>
          </div>
          <RoundTimer endTime={round.endTime} phase={round.phase} />
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
          <h2 className="text-lg font-bold text-foreground">Agent Predictions</h2>
          <button
            onClick={() => setShowRevealed(!showRevealed)}
            className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showRevealed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {showRevealed ? "Revealed" : "Hidden"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {round.predictions.map((pred, i) => {
            const agent = mockAgents.find(a => a.id === pred.agentId);
            return (
              <motion.div
                key={pred.agentId}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                className={`rounded-xl border p-4 transition-all ${
                  showRevealed && pred.direction === "UP"
                    ? "border-success/30 bg-success/5"
                    : showRevealed && pred.direction === "DOWN"
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-border bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{agent?.avatar}</span>
                  <span className="font-semibold text-sm text-foreground">{pred.agentName}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Direction</div>
                    {showRevealed ? (
                      <span className={`inline-flex items-center gap-1 font-mono font-bold text-lg ${
                        pred.direction === "UP" ? "text-success" : "text-destructive"
                      }`}>
                        {pred.direction === "UP" ? <ArrowUp className="h-5 w-5" /> : <ArrowDown className="h-5 w-5" />}
                        {pred.direction}
                      </span>
                    ) : (
                      <span className="font-mono text-lg font-bold text-muted-foreground">???</span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Confidence</div>
                    <span className="font-mono text-lg font-bold text-foreground">{showRevealed ? `${pred.confidence}%` : "—"}</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Agent reasoning feed */}
      {showRevealed && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <h2 className="text-lg font-bold text-foreground mb-4">Agent Reasoning Feed</h2>
          <div className="space-y-3">
            {round.predictions.filter(p => p.reasoning).map((pred, i) => {
              const agent = mockAgents.find(a => a.id === pred.agentId);
              return (
                <motion.div
                  key={pred.agentId}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.08 }}
                  className="flex gap-3 rounded-xl border border-border bg-muted/30 p-4"
                >
                  <span className="text-lg mt-0.5">{agent?.avatar}</span>
                  <div>
                    <span className="text-sm font-semibold text-foreground">{pred.agentName}</span>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">"{pred.reasoning}"</p>
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
