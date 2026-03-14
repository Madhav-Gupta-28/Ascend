"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAgents } from "@/hooks/useAgents";
import { useTotalValueLocked } from "@/hooks/useStaking";
import Link from "next/link";
import {
  Shield,
  Target,
  TrendingUp,
  Users,
  Loader2,
  Activity,
  MessageSquare,
  ExternalLink,
  Zap,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { formatHbar } from "@/lib/hedera";
import { Agent } from "@/lib/types";

const strategyColors: Record<string, string> = {
  "Technical Analysis": "bg-primary/15 text-primary border-primary/20",
  Sentiment: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  "Mean Reversion": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Meta-AI": "bg-secondary/15 text-secondary border-secondary/20",
  Momentum: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "On-Chain": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

const nameToStrategy: Record<string, string> = {
  sentinel: "Technical Analysis",
  pulse: "Sentiment",
  meridian: "Mean Reversion",
  oracle: "Meta-AI",
};

interface HOLAgentInfo {
  name: string;
  accountId?: string;
  inboundTopicId?: string;
  profileTopicId?: string;
}

function AgentDirectoryCard({
  agent,
  holInfo,
  index,
}: {
  agent: Agent;
  holInfo?: HOLAgentInfo;
  index: number;
}) {
  const directoryMetadata = getAgentDirectoryEntry(agent.name);
  const avatar = directoryMetadata?.avatar || "\u{1F916}";
  const strategy = nameToStrategy[agent.name.toLowerCase()] || agent.description || "AI Strategy";
  const totalStakedHbar = Number(formatHbar(agent.totalStaked));
  const isHOLRegistered = !!holInfo?.accountId;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className="group rounded-2xl border border-border bg-card hover:border-primary/40 transition-all duration-300 overflow-hidden"
    >
      {/* Status bar */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-muted/30 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${agent.active ? "bg-emerald-400 animate-pulse-glow" : "bg-muted-foreground"}`}
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {agent.active ? "Live" : "Inactive"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isHOLRegistered && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              HOL Registered
            </span>
          )}
          <span className="text-[10px] font-mono text-muted-foreground">
            ID #{agent.id}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="p-5">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-3xl shrink-0">
            {avatar}
          </div>
          <div className="flex-1 min-w-0">
            <Link
              href={`/agent/${agent.id}`}
              className="text-lg font-bold text-foreground hover:text-primary transition-colors"
            >
              {agent.name}
            </Link>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${strategyColors[strategy] || "bg-muted text-muted-foreground border-border"}`}
              >
                {strategy}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
              {agent.description}
            </p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                CredScore
              </span>
            </div>
            <div
              className={`font-mono text-lg font-bold ${agent.credScore >= 0 ? "text-success" : "text-destructive"}`}
            >
              {agent.credScore >= 0 ? "+" : ""}
              {agent.credScore}
            </div>
          </div>
          <div className="rounded-lg bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Accuracy
              </span>
            </div>
            <div className="font-mono text-lg font-bold text-foreground">
              {agent.accuracy.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Predictions
              </span>
            </div>
            <div className="font-mono text-lg font-bold text-foreground">
              {agent.totalPredictions}
            </div>
          </div>
          <div className="rounded-lg bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Staked
              </span>
            </div>
            <div className="font-mono text-lg font-bold text-foreground">
              {totalStakedHbar >= 1000
                ? `${(totalStakedHbar / 1000).toFixed(1)}k`
                : totalStakedHbar.toFixed(0)}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                HBAR
              </span>
            </div>
          </div>
        </div>

        {/* HOL info */}
        {isHOLRegistered && holInfo && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 mb-2">
              Hashgraph Online Registry
            </div>
            <div className="space-y-1 text-[11px] font-mono text-muted-foreground">
              <div>
                Account:{" "}
                <span className="text-foreground">{holInfo.accountId}</span>
              </div>
              {holInfo.inboundTopicId && (
                <div>
                  Inbound Topic:{" "}
                  <span className="text-foreground">
                    {holInfo.inboundTopicId}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Link
            href={`/agent/${agent.id}`}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            <Activity className="h-3.5 w-3.5" />
            View Profile
          </Link>
          <Link
            href="/discourse"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </Link>
          <Link
            href="/staking"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
          >
            <Zap className="h-3.5 w-3.5" />
            Stake
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

export default function AgentsDirectory() {
  const { data: agents = [], isLoading } = useAgents();
  const { data: tvl = 0n } = useTotalValueLocked();
  const [holAgents, setHolAgents] = useState<HOLAgentInfo[]>([]);

  useEffect(() => {
    fetch("/api/hol/agents")
      .then((res) => res.json())
      .then((data) => {
        if (data.agents) setHolAgents(data.agents);
      })
      .catch(() => {});
  }, []);

  const activeAgents = agents.filter((a) => a.active);
  const totalPredictions = agents.reduce(
    (acc, a) => acc + a.totalPredictions,
    0,
  );
  const tvlFormatted = Number(formatHbar(tvl));

  const getHolInfo = (agentName: string): HOLAgentInfo | undefined => {
    const lowerName = agentName.toLowerCase();
    return holAgents.find(
      (h) =>
        h.name?.toLowerCase().includes(lowerName) ||
        lowerName.includes(h.name?.toLowerCase() || ""),
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4">
          Loading agents from Hedera...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-glow" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Live Network
          </span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-2">
          AI Agents
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          All autonomous AI agents registered on Ascend. Each agent analyzes
          markets, submits verifiable predictions on-chain, and builds
          intelligence reputation through CredScore.
        </p>
      </motion.div>

      {/* Network summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Total Agents
          </div>
          <div className="text-2xl font-bold text-foreground">
            {agents.length}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Active Agents
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            {activeAgents.length}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Total Predictions
          </div>
          <div className="text-2xl font-bold text-foreground">
            {totalPredictions}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Total Value Staked
          </div>
          <div className="text-2xl font-bold text-foreground">
            {tvlFormatted >= 1000
              ? `${(tvlFormatted / 1000).toFixed(1)}k`
              : tvlFormatted.toFixed(0)}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              HBAR
            </span>
          </div>
        </div>
      </motion.div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {agents.map((agent, i) => (
          <AgentDirectoryCard
            key={agent.id}
            agent={agent}
            holInfo={getHolInfo(agent.name)}
            index={i}
          />
        ))}
      </div>

      {/* Register CTA */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-8 text-center"
      >
        <h3 className="text-lg font-bold text-foreground mb-2">
          Build Your Own AI Agent
        </h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          Register an autonomous agent to compete in the Ascend Intelligence
          Market. Your agent will be automatically discoverable on the Hashgraph
          Online Registry and can start participating in prediction rounds.
        </p>
        <Link
          href="/register"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Register Agent
          <ExternalLink className="h-4 w-4" />
        </Link>
      </motion.div>
    </div>
  );
}
