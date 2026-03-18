import { Agent } from "@/lib/types";
import Link from "next/link";
import { motion } from "framer-motion";
import { TrendingUp, Users } from "lucide-react";
import { getAgentDirectoryEntry, displayAgentName } from "@/lib/agentDirectory";

const strategyColors: Record<string, string> = {
  "Technical Analysis": "bg-primary/15 text-primary border-primary/20",
  "Sentiment & Momentum": "bg-pink-500/15 text-pink-400 border-pink-500/20",
  "Mean Reversion": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Meta-Analysis": "bg-secondary/15 text-secondary border-secondary/20",
};

import { formatHbar } from "@/lib/hedera";

export default function AgentCard({ agent, index }: { agent: Agent; index: number }) {
  const rank = index + 1;
  const directoryMetadata = getAgentDirectoryEntry(agent.name);
  const avatar = directoryMetadata?.avatar || "🤖";

  const strategy = directoryMetadata?.strategy || "AI Strategy";

  const totalStakedHbar = Number(formatHbar(agent.totalStaked));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
    >
      <Link
        href={`/agent/${agent.id}`}
        className={`group flex items-center gap-4 rounded-xl border bg-card p-4 transition-all duration-300 hover:border-primary/40 hover:bg-card/80 ${
          rank === 1 ? "border-amber-500/40 shadow-[0_0_24px_rgba(245,158,11,0.15)]" : "border-border"
        }`}
      >
        {/* Rank */}
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-bold ${rank === 1 ? "bg-amber-500/20 text-amber-400" :
          rank === 2 ? "bg-secondary/20 text-secondary" :
            rank === 3 ? "bg-primary/20 text-primary" :
              "bg-muted text-muted-foreground"
          }`}>
          #{rank}
        </div>

        {/* Avatar + Name */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-2xl">{avatar}</span>
          <div className="min-w-0">
            <div className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {displayAgentName(agent.name)}
            </div>
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${strategyColors[strategy] || "bg-muted text-muted-foreground"}`}>
              {strategy}
            </span>
          </div>
        </div>

        {/* CredScore */}
        <div className="hidden sm:block text-right">
          <div className="text-xs text-muted-foreground">CredScore</div>
          <div className={`font-mono font-bold ${agent.credScore >= 0 ? 'text-success' : 'text-destructive'}`}>
            {agent.credScore >= 0 ? '+' : ''}{agent.credScore}
          </div>
          {agent.credScore > 0 && (
            <div className="mt-0.5 text-[10px] font-mono text-amber-400">
              🔥 +CredScore
            </div>
          )}
        </div>

        {/* Accuracy */}
        <div className="hidden md:block text-right">
          <div className="text-xs text-muted-foreground">Accuracy</div>
          <div className="font-mono font-semibold text-foreground">{agent.accuracy.toFixed(1)}%</div>
        </div>

        {/* Predictions */}
        <div className="hidden lg:flex items-center gap-1 text-right">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-sm text-muted-foreground">{agent.totalPredictions}</span>
        </div>

        {/* Staked */}
        <div className="hidden lg:flex items-center gap-1 text-right">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-sm text-foreground">
            {totalStakedHbar >= 1000
              ? `${(totalStakedHbar / 1000).toFixed(1)}k`
              : totalStakedHbar.toFixed(0)}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
