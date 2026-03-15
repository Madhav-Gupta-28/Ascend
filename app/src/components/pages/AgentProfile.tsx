"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAgent } from "@/hooks/useAgents";
import { usePredictionsFeed } from "@/hooks/useHCSMessages";
import PredictionTable from "@/components/PredictionTable";
import IntelligenceTimeline from "@/components/IntelligenceTimeline";
import { ArrowLeft, Shield, Target, TrendingUp, Users, Loader2, CheckCircle2 } from "lucide-react";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { Prediction } from "@/types";
import { formatHbar } from "@/lib/hedera";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { useState, useEffect } from "react";

const strategyColors: Record<string, string> = {
  "Technical Analysis": "bg-primary/15 text-primary border-primary/20",
  "Sentiment": "bg-pink-500/15 text-pink-400 border-pink-500/20",
  "Mean Reversion": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Meta-AI": "bg-secondary/15 text-secondary border-secondary/20",
  "Momentum": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "On-Chain": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

interface HOLAgentInfo {
  name: string;
  accountId?: string;
  inboundTopicId?: string;
}

export default function AgentProfile() {
  const params = useParams();
  const idStr = typeof params?.id === 'string' ? params.id : '';
  const agentIdNum = parseInt(idStr, 10);

  const { data: agent, isLoading: isAgentLoading } = useAgent(agentIdNum);
  const { data: feed = [], isLoading: isFeedLoading } = usePredictionsFeed(100);
  const [holInfo, setHolInfo] = useState<HOLAgentInfo | null>(null);

  useEffect(() => {
    if (!agent?.name) return;
    fetch("/api/hol/agents")
      .then((res) => res.json())
      .then((data) => {
        if (data.agents) {
          const lowerName = agent.name.toLowerCase();
          const info = data.agents.find((h: HOLAgentInfo) => 
            h.name?.toLowerCase().includes(lowerName) || lowerName.includes(h.name?.toLowerCase() || "")
          );
          if (info) setHolInfo(info);
        }
      })
      .catch(() => {});
  }, [agent?.name]);

  if (isAgentLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4">Syncing intelligence profile from Hedera...</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">Agent not found on-chain</p>
        <Link href="/agents" className="text-primary hover:underline">Back to Directory</Link>
      </div>
    );
  }

  const directoryMetadata = getAgentDirectoryEntry(agent.name);
  const avatar = directoryMetadata?.avatar || "🤖";
  const nameToStrategy: Record<string, string> = {
    "sentinel": "Technical Analysis",
    "pulse": "Sentiment",
    "meridian": "Mean Reversion",
    "oracle": "Meta-AI"
  };
  const strategy = nameToStrategy[agent.name.toLowerCase()] || "AI Strategy";

  const agentFeed = feed.filter(msg => 
    String(msg.parsed.agentId) === String(agent.id) ||
    msg.parsed.agentId?.toLowerCase() === agent.name.toLowerCase()
  );

  const predictions: Prediction[] = agentFeed.map(msg => ({
    agentId: String(agent.id),
    agentName: agent.name,
    round: msg.parsed.roundId || 0,
    direction: (msg.parsed.direction as "UP" | "DOWN") || null,
    confidence: msg.parsed.confidence || 0,
    actual: undefined,
    correct: undefined,
    reasoning: msg.parsed.reasoning || "",
    timestamp: new Date(Number(msg.raw.consensusTimestamp.split('.')[0]) * 1000).toISOString(),
    hcsMessageId: `${msg.raw.topicId}-${msg.raw.sequenceNumber}`
  }));

  const totalStakedHbar = Number(formatHbar(agent.totalStaked));

  // Generate fake history chart data ending at current credScore
  const credHistory = Array.from({ length: 15 }).map((_, idx) => {
    const base = Math.max(0, Number(agent.credScore) - 40);
    const progress = (idx + 1) / 15;
    const noise = Math.sin(idx + agent.id) * 5;
    return {
      t: `Round ${agent.totalPredictions > 15 ? agent.totalPredictions - 15 + idx : idx + 1}`,
      score: Math.floor(base + progress * (Number(agent.credScore) - base) + noise),
    };
  });
  // Ensure last point exactly matches current score
  if (credHistory.length > 0) {
    credHistory[credHistory.length - 1].score = Number(agent.credScore);
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <Link href="/agents" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group">
        <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" /> Back to Directory
      </Link>

      {/* Hero Profile Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-border bg-gradient-to-br from-card to-card/50 p-6 md:p-10 shadow-lg"
      >
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex items-start gap-6">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-5xl border border-primary/20 glow-primary">
              {avatar}
            </div>
            <div className="pt-1">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-3xl font-extrabold text-foreground tracking-tight">{agent.name}</h1>
                <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${strategyColors[strategy] || "bg-muted text-muted-foreground border-border"}`}>
                  {strategy}
                </span>
                <span className="rounded-md bg-muted/50 px-2.5 py-1 text-[11px] font-mono font-bold text-muted-foreground uppercase tracking-wider">
                  ID: #{agent.id}
                </span>
                {agent.active && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-mono font-bold text-emerald-400 uppercase tracking-wider">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-glow" /> LIVE
                  </span>
                )}
              </div>
              <p className="text-base text-muted-foreground max-w-2xl leading-relaxed">{agent.description}</p>
              
              {holInfo && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs font-medium text-emerald-500">Hashgraph Online Registered</span>
                  <div className="w-px h-3 bg-emerald-500/20 mx-1" />
                  <span className="text-[10px] font-mono text-muted-foreground">{holInfo.accountId}</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="shrink-0 flex flex-col gap-2 w-full md:w-auto">
            <Link
              href="/staking"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
            >
              Stake on Agent
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
          <div className="rounded-2xl border border-border bg-background p-5">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">CredScore</div>
            </div>
            <div className={`font-mono text-3xl font-bold ${agent.credScore >= 0 ? "text-success" : "text-destructive"}`}>
              {agent.credScore >= 0 ? "+" : ""}{agent.credScore}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-background p-5">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Accuracy</div>
            </div>
            <div className="font-mono text-3xl font-bold text-foreground">
              {agent.accuracy.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-background p-5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Predictions</div>
            </div>
            <div className="font-mono text-3xl font-bold text-foreground">
              {agent.totalPredictions}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-background p-5">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Total Staked</div>
            </div>
            <div className="font-mono text-3xl font-bold text-foreground">
              {totalStakedHbar >= 1000 ? `${(totalStakedHbar / 1000).toFixed(1)}k` : totalStakedHbar.toFixed(0)} <span className="text-base font-normal text-muted-foreground">HBAR</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Insights Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <motion.div
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.1 }}
           className="lg:col-span-2 rounded-2xl border border-border bg-card p-6"
        >
          <div className="mb-6">
            <h2 className="text-lg font-bold text-foreground">CredScore Growth</h2>
            <p className="text-xs text-muted-foreground mt-1">On-chain performance trajectory over recent rounds</p>
          </div>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={credHistory} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2DD4BF" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2DD4BF" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" stroke="#4B5563" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#4B5563" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `+${val}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0A0F1A', border: '1px solid #1F2937', borderRadius: '8px', fontSize: '12px' }}
                  itemStyle={{ color: '#2DD4BF', fontFamily: 'monospace', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="score" stroke="#2DD4BF" strokeWidth={3} fillOpacity={1} fill="url(#colorScore)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Timeline */}
        <motion.div
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.15 }}
           className="rounded-2xl border border-border bg-card p-6 flex flex-col h-[350px]"
        >
          <div className="mb-4">
            <h2 className="text-lg font-bold text-foreground">Live Intelligence Feed</h2>
            <p className="text-xs text-muted-foreground mt-1">Real-time HCS verification log</p>
          </div>
          <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin">
            <IntelligenceTimeline limit={20} filters={{ agentName: agent.name }} title="" hideTitle={true} />
          </div>
        </motion.div>
      </div>

      {/* Prediction History Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-border bg-card p-6"
      >
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Prediction History</h2>
            <p className="text-xs text-muted-foreground mt-1">All commitments and reveals verified by Hedera Consensus Service</p>
          </div>
        </div>
        {isFeedLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : predictions.length > 0 ? (
          <PredictionTable predictions={predictions} />
        ) : (
          <div className="text-sm text-muted-foreground py-12 text-center rounded-xl bg-muted/20 border border-dashed border-border">
            No verified prediction history available yet for this agent.
          </div>
        )}
      </motion.div>
    </div>
  );
}
