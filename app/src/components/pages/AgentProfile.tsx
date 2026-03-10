import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAgent } from "@/hooks/useAgents";
import { usePredictionsFeed } from "@/hooks/useHCSMessages";
import PredictionTable from "@/components/PredictionTable";
import IntelligenceTimeline from "@/components/IntelligenceTimeline";
import { ArrowLeft, Shield, Target, TrendingUp, Users, Loader2 } from "lucide-react";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { Prediction } from "@/types";
import { formatHbar } from "@/lib/hedera"; // Added this import

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
  const idStr = typeof params?.id === 'string' ? params.id : '';
  const agentIdNum = parseInt(idStr, 10);

  const { data: agent, isLoading: isAgentLoading } = useAgent(agentIdNum);
  const { data: feed = [], isLoading: isFeedLoading } = usePredictionsFeed(100);

  if (isAgentLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4">Loading agent profile from Hedera...</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">Agent not found on-chain</p>
        <Link href="/" className="text-primary hover:underline">Back to Intelligence Board</Link>
      </div>
    );
  }

  // Derive offline metadata
  const directoryMetadata = getAgentDirectoryEntry(agent.name);
  const avatar = directoryMetadata?.avatar || "🤖";

  const nameToStrategy: Record<string, string> = {
    "sentinel": "Technical Analysis",
    "pulse": "Sentiment",
    "meridian": "Mean Reversion",
    "oracle": "Meta-AI"
  };
  const strategy = nameToStrategy[agent.name.toLowerCase()] || "AI Strategy";

  // Filter HCS messages to match this agent
  // HCS feed agentIds are usually strings representing the index or name, we map it to the string id
  const agentFeed = feed.filter(msg => {
    // Contract agentId vs HCS agentId. We use both the numeric ID and the string name to catch all
    return String(msg.parsed.agentId) === String(agent.id) ||
      msg.parsed.agentId?.toLowerCase() === agent.name.toLowerCase();
  });

  // Map HCS messages to the UI Prediction shape
  const predictions: Prediction[] = agentFeed.map(msg => ({
    agentId: String(agent.id),
    agentName: agent.name,
    round: msg.parsed.roundId || 0,
    direction: (msg.parsed.direction as "UP" | "DOWN") || null,
    confidence: msg.parsed.confidence || 0,
    actual: undefined, // Needs Historic round outcome (placeholder for hackathon demo unless joined)
    correct: undefined, // Same as above
    reasoning: msg.parsed.reasoning || "",
    timestamp: new Date(Number(msg.raw.consensusTimestamp.split('.')[0]) * 1000).toISOString(),
    hcsMessageId: `${msg.raw.topicId}-${msg.raw.sequenceNumber}`
  }));

  const totalStakedHbar = Number(formatHbar(agent.totalStaked));

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
            {avatar}
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-foreground">{agent.name}</h1>
              <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${strategyColors[strategy] || "bg-muted text-muted-foreground border-border"}`}>
                {strategy}
              </span>
              <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-mono font-bold text-muted-foreground border border-border">
                Agent ID: #{agent.id}
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
              <div className={`font-mono text-lg font-bold ${agent.credScore >= 0 ? "text-success" : "text-destructive"}`}>
                {agent.credScore >= 0 ? "+" : ""}{agent.credScore}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Accuracy</div>
              <div className="font-mono text-lg font-bold text-foreground">{agent.accuracy.toFixed(1)}%</div>
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
              <div className="font-mono text-lg font-bold text-foreground">
                {totalStakedHbar >= 1000
                  ? `${(totalStakedHbar / 1000).toFixed(1)} k`
                  : totalStakedHbar.toFixed(0)} HBAR
              </div>
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
        <h2 className="text-lg font-bold text-foreground mb-4">CredScore Tracking</h2>
        <div className="flex items-center justify-center h-[250px] border border-dashed border-border rounded-xl bg-muted/20 text-muted-foreground text-sm">
          Live charting will populate as continuous prediction history is analyzed from HCS.
        </div>
      </motion.div>

      {/* Agent-scoped Intelligence Timeline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-2xl border border-border bg-card p-6"
      >
        <IntelligenceTimeline
          limit={20}
          filters={{ agentName: agent.name }}
          title={`${agent.name} — Timeline`}
        />
      </motion.div>

      {/* Prediction history */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-border bg-card p-6"
      >
        <h2 className="text-lg font-bold text-foreground mb-4">Verified HCS Prediction History</h2>
        {isFeedLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : predictions.length > 0 ? (
          <PredictionTable predictions={predictions} />
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-xl border-border">No verified prediction history available for this agent on HCS.</p>
        )}
      </motion.div>
    </div>
  );
}
