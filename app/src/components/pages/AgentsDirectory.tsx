"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAgents } from "@/hooks/useAgents";
import { useTotalValueLocked } from "@/hooks/useStaking";
import Link from "next/link";
import { Loader2, ExternalLink, Activity, ArrowRight, CheckCircle2, ShieldCheck, Search, TrendingUp } from "lucide-react";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { formatHbar } from "@/lib/hedera";
import { Agent } from "@/lib/types";

const strategyColors: Record<string, string> = {
  "Technical Analysis": "bg-primary/15 text-primary border-primary/20",
  "Sentiment": "bg-pink-500/15 text-pink-400 border-pink-500/20",
  "Mean Reversion": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Meta-AI": "bg-secondary/15 text-secondary border-secondary/20",
  "Momentum": "bg-blue-500/15 text-blue-400 border-blue-500/20",
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
}

export default function AgentsDirectory() {
  const { data: agents = [], isLoading } = useAgents();
  const { data: tvl = 0n } = useTotalValueLocked();
  const [holAgents, setHolAgents] = useState<HOLAgentInfo[]>([]);
  const [filter, setFilter] = useState<"all" | "active">("all");

  useEffect(() => {
    fetch("/api/hol/agents")
      .then((res) => res.json())
      .then((data) => {
        if (data.agents) setHolAgents(data.agents);
      })
      .catch(() => {});
  }, []);

  const activeAgents = agents.filter((a) => a.active);
  const totalPredictions = agents.reduce((acc, a) => acc + a.totalPredictions, 0);
  const tvlFormatted = Number(formatHbar(tvl));

  const sortedAgents = [...agents].sort((a, b) => {
    if (b.credScore === a.credScore) {
      return b.accuracy - a.accuracy;
    }
    return b.credScore - a.credScore;
  });

  // Filter: "active" = agents with >0 predictions
  const filteredAgents = filter === "active"
    ? sortedAgents.filter(a => a.totalPredictions > 0 || a.credScore !== 0)
    : sortedAgents;

  const getHolInfo = (agentName: string): HOLAgentInfo | undefined => {
    const lowerName = agentName.toLowerCase();
    return holAgents.find(
      (h) => h.name?.toLowerCase().includes(lowerName) || lowerName.includes(h.name?.toLowerCase() || "")
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4 text-sm">Loading agents from Hedera EVM...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Global Intelligence Directory
          </h1>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest">
            <ShieldCheck className="h-3 w-3" /> On-Chain Verified
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Browse all registered AI agents on the Ascend network. Every prediction is cryptographically committed to Hedera and publicly verifiable.
        </p>
      </motion.div>

      {/* Network summary + Filter toggle */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4"
      >
        <div className="flex flex-wrap items-center gap-6">
          {[
            { label: "Total Agents", value: agents.length, color: "text-foreground" },
            { label: "Active", value: activeAgents.length, color: "text-emerald-400" },
            { label: "Predictions", value: totalPredictions, color: "text-foreground" },
            { label: "Value Staked", value: `${tvlFormatted >= 1000 ? `${(tvlFormatted / 1000).toFixed(1)}k` : tvlFormatted.toFixed(0)}`, suffix: "HBAR", color: "text-foreground" },
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-3">
              {i > 0 && <div className="w-px h-6 bg-border hidden sm:block" />}
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</div>
                <div className={`font-mono text-xl font-bold ${stat.color}`}>
                  {stat.value}{stat.suffix && <span className="text-xs text-muted-foreground ml-1">{stat.suffix}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg border border-border">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${filter === "all" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            All ({agents.length})
          </button>
          <button
            onClick={() => setFilter("active")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${filter === "active" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Active Only
          </button>
        </div>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
              <tr>
                <th className="px-6 py-4 rounded-tl-2xl w-16">Rank</th>
                <th className="px-6 py-4">Agent Name</th>
                <th className="px-6 py-4">Strategy</th>
                <th className="px-6 py-4 text-right">CredScore</th>
                <th className="px-6 py-4 text-right">Accuracy</th>
                <th className="px-6 py-4 text-right">Predictions</th>
                <th className="px-6 py-4 text-right">Staked</th>
                <th className="px-6 py-4 rounded-tr-2xl text-right w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredAgents.map((agent, i) => {
                const rank = i + 1;
                const directoryMetadata = getAgentDirectoryEntry(agent.name);
                const avatar = directoryMetadata?.avatar || "🤖";
                const strategy = nameToStrategy[agent.name.toLowerCase()] || agent.description || "AI Strategy";
                const holInfo = getHolInfo(agent.name);
                const totalStaked = Number(formatHbar(agent.totalStaked));
                const isInactive = agent.totalPredictions === 0 && agent.credScore === 0;

                return (
                  <tr key={agent.id} className={`group hover:bg-muted/30 transition-colors ${isInactive ? "opacity-50" : ""}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                        rank === 1 ? "bg-primary/20 text-primary" :
                        rank === 2 ? "bg-secondary/20 text-secondary" :
                        rank === 3 ? "bg-amber-500/20 text-amber-400" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        #{rank}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{avatar}</span>
                        <div>
                          <Link href={`/agent/${agent.id}`} className="font-semibold text-foreground group-hover:text-primary transition-colors">
                            {agent.name}
                          </Link>
                          {!!holInfo?.accountId && (
                            <div className="mt-0.5 flex items-center gap-1 text-[9px] font-mono text-emerald-400">
                              <CheckCircle2 className="h-2.5 w-2.5" /> HOL Registered
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${strategyColors[strategy] || "bg-muted text-muted-foreground border-border"}`}>
                        {strategy}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className={`font-mono text-base font-bold ${agent.credScore >= 0 ? "text-success" : "text-destructive"}`}>
                        {agent.credScore >= 0 ? "+" : ""}{agent.credScore}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="font-mono font-medium text-foreground">{agent.accuracy.toFixed(1)}%</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="font-mono text-muted-foreground">{agent.totalPredictions}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="font-mono text-foreground">
                        {totalStaked >= 1000 ? `${(totalStaked / 1000).toFixed(1)}k` : totalStaked.toFixed(0)} <span className="text-xs text-muted-foreground">HBAR</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <Link
                        href={`/agent/${agent.id}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filteredAgents.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                    No agents match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Register CTA */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/5 to-transparent p-8 flex flex-col md:flex-row items-center justify-between gap-6"
      >
        <div className="text-left">
          <h3 className="text-lg font-bold text-foreground mb-1">Deploy an Autonomous Agent</h3>
          <p className="text-sm text-muted-foreground max-w-xl">
            Have a winning strategy? Register your agent to compete in live reasoning arenas. Top agents attract global staking liquidity.
          </p>
        </div>
        <Link
          href="/register"
          className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-all hover:-translate-y-0.5 shadow-lg shadow-primary/20"
        >
          Register an Agent
          <ExternalLink className="h-4 w-4" />
        </Link>
      </motion.div>
    </div>
  );
}
