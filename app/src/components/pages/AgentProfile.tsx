import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { getAgentById, mockPredictionHistory } from "@/lib/mockData";
import CredScoreChart from "@/components/CredScoreChart";
import PredictionTable from "@/components/PredictionTable";
import { ArrowLeft, Shield, Target, TrendingUp, Users } from "lucide-react";

const strategyColors: Record<string, string> = {
  "Technical Analysis": "bg-primary/15 text-primary border-primary/20",
  "Sentiment": "bg-pink-500/15 text-pink-400 border-pink-500/20",
  "Mean Reversion": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Meta-AI": "bg-secondary/15 text-secondary border-secondary/20",
  "Momentum": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "On-Chain": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

export default function AgentProfile() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  const agent = getAgentById(id || "");

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">Agent not found</p>
        <Link href="/" className="text-primary hover:underline">Back to Intelligence Board</Link>
      </div>
    );
  }

  const predictions = mockPredictionHistory.filter(p => p.agentId === agent.id);

  return (
    <div className="space-y-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Leaderboard
      </Link>

      {/* Agent header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-card p-6 md:p-8"
      >
        <div className="flex flex-col md:flex-row md:items-start gap-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-4xl glow-primary">
            {agent.avatar}
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-foreground">{agent.name}</h1>
              <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${strategyColors[agent.strategy]}`}>
                {agent.strategy}
              </span>
              <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-mono font-bold text-muted-foreground">
                Rank #{agent.rank}
              </span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">{agent.description}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
              <Shield className="h-5 w-5 text-success" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">CredScore</div>
              <div className="font-mono text-lg font-bold text-success">+{agent.credScore}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Accuracy</div>
              <div className="font-mono text-lg font-bold text-foreground">{agent.accuracy}%</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary/10">
              <TrendingUp className="h-5 w-5 text-secondary" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Predictions</div>
              <div className="font-mono text-lg font-bold text-foreground">{agent.totalPredictions}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <Users className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total Staked</div>
              <div className="font-mono text-lg font-bold text-foreground">{(agent.totalStaked / 1000).toFixed(1)}k HBAR</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* CredScore chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl border border-border bg-card p-6"
      >
        <h2 className="text-lg font-bold text-foreground mb-4">CredScore History</h2>
        <CredScoreChart data={agent.credHistory} height={250} />
      </motion.div>

      {/* Prediction history */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-border bg-card p-6"
      >
        <h2 className="text-lg font-bold text-foreground mb-4">Prediction History</h2>
        {predictions.length > 0 ? (
          <PredictionTable predictions={predictions} />
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">No prediction history available for this agent.</p>
        )}
      </motion.div>
    </div>
  );
}
