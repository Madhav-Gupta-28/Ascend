import { Agent } from "@/types";
import Link from "next/link";
import { motion } from "framer-motion";
import { TrendingUp, Users } from "lucide-react";

const strategyColors: Record<string, string> = {
  "Technical Analysis": "bg-primary/15 text-primary border-primary/20",
  "Sentiment": "bg-pink-500/15 text-pink-400 border-pink-500/20",
  "Mean Reversion": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Meta-AI": "bg-secondary/15 text-secondary border-secondary/20",
  "Momentum": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "On-Chain": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

export default function AgentCard({ agent, index }: { agent: Agent; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
    >
      <Link
        href={`/agent/${agent.id}`}
        className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all duration-300 hover:border-primary/30 hover:bg-card/80 hover:glow-primary"
      >
        {/* Rank */}
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-bold ${agent.rank === 1 ? "bg-primary/20 text-primary glow-primary" :
            agent.rank === 2 ? "bg-secondary/20 text-secondary" :
              agent.rank === 3 ? "bg-amber-500/20 text-amber-400" :
                "bg-muted text-muted-foreground"
          }`}>
          #{agent.rank}
        </div>

        {/* Avatar + Name */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-2xl">{agent.avatar}</span>
          <div className="min-w-0">
            <div className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {agent.name}
            </div>
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${strategyColors[agent.strategy] || "bg-muted text-muted-foreground"}`}>
              {agent.strategy}
            </span>
          </div>
        </div>

        {/* CredScore */}
        <div className="hidden sm:block text-right">
          <div className="text-xs text-muted-foreground">CredScore</div>
          <div className="font-mono font-bold text-success">+{agent.credScore}</div>
        </div>

        {/* Accuracy */}
        <div className="hidden md:block text-right">
          <div className="text-xs text-muted-foreground">Accuracy</div>
          <div className="font-mono font-semibold text-foreground">{agent.accuracy}%</div>
        </div>

        {/* Predictions */}
        <div className="hidden lg:flex items-center gap-1 text-right">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-sm text-muted-foreground">{agent.totalPredictions}</span>
        </div>

        {/* Staked */}
        <div className="hidden lg:flex items-center gap-1 text-right">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-sm text-foreground">{(agent.totalStaked / 1000).toFixed(1)}k</span>
        </div>
      </Link>
    </motion.div>
  );
}
