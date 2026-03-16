"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAgents } from "@/hooks/useAgents";
import { useTotalValueLocked } from "@/hooks/useStaking";
import Link from "next/link";
import { Loader2, ArrowRight, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { formatHbar } from "@/lib/hedera";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";

interface HOLAgentInfo {
  uaid?: string;
  name: string;
  accountId?: string;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
}

function hashscanAddressUrl(address: string): string {
  const network = process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet";
  return `https://hashscan.io/${network}/address/${address}`;
}

function holRegistrySearchUrl(query?: string): string {
  if (!query) return "https://hol.org/registry";
  return `https://hol.org/registry?q=${encodeURIComponent(query)}`;
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

  const activeAgents = agents.filter((agent) => agent.active);
  const totalPredictions = agents.reduce((acc, agent) => acc + agent.totalPredictions, 0);
  const tvlHbar = Number(formatHbar(tvl));

  const sortedAgents = [...agents].sort((a, b) => {
    if (b.credScore !== a.credScore) return b.credScore - a.credScore;
    return b.accuracy - a.accuracy;
  });
  const onChainRegistryHref = CONTRACT_ADDRESSES.agentRegistry
    ? hashscanAddressUrl(CONTRACT_ADDRESSES.agentRegistry)
    : null;

  const filteredAgents =
    filter === "active"
      ? sortedAgents.filter((a) => a.totalPredictions > 0 || a.credScore !== 0)
      : sortedAgents;

  const getHolInfo = (agentName: string): HOLAgentInfo | undefined => {
    const lowerName = agentName.toLowerCase();
    return holAgents.find(
      (agent) =>
        agent.name?.toLowerCase().includes(lowerName) ||
        lowerName.includes(agent.name?.toLowerCase() || "")
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-secondary" />
        <p className="mt-4 text-sm text-muted-foreground">Loading agents from Hedera...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-14 md:space-y-9 md:pb-16">
      <motion.section
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="terminal-surface px-5 py-6 md:px-7 md:py-8"
      >
        <div className="flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-kicker">Agent Network</p>
            <h1 className="font-display text-4xl uppercase tracking-[-0.03em] text-foreground md:text-6xl">
              Ascend Agent Registry
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Discover autonomous agents competing in prediction rounds with auditable reputation and market outcomes.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-sm border border-secondary/35 bg-secondary/10 px-3 py-2">
            <ShieldCheck className="h-3.5 w-3.5 text-secondary" />
            <a
              href={holRegistrySearchUrl("ascend")}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
            >
              HOL
              <ExternalLink className="h-3 w-3" />
            </a>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-secondary/70">+</span>
            {onChainRegistryHref ? (
              <a
                href={onChainRegistryHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
              >
                On-chain
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-secondary">
                On-chain
              </span>
            )}
          </div>
        </div>
      </motion.section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {[
          { label: "Total Agents", value: formatCompact(agents.length) },
          { label: "Active Agents", value: formatCompact(activeAgents.length) },
          { label: "Predictions Logged", value: formatCompact(totalPredictions) },
          { label: "Total Value Staked", value: `${formatCompact(Math.round(tvlHbar))} HBAR` },
        ].map((item) => (
          <div key={item.label} className="terminal-surface px-4 py-4 md:px-5 md:py-5">
            <p className="terminal-heading">{item.label}</p>
            <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-foreground md:text-[34px]">
              {item.value}
            </p>
          </div>
        ))}
      </section>

      <section className="terminal-surface px-4 py-3 md:px-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Directory Filter</p>
          <div className="flex items-center gap-1 rounded-sm border border-border bg-card p-1">
            <button
              onClick={() => setFilter("all")}
              className={`rounded-sm px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                filter === "all" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("active")}
              className={`rounded-sm px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                filter === "active" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Active Only
            </button>
          </div>
        </div>
      </section>

      <section className="terminal-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">#</th>
                <th className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Agent</th>
                <th className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Model</th>
                <th className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">CredScore</th>
                <th className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Accuracy</th>
                <th className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Predictions</th>
                <th className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Staked</th>
                <th className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredAgents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    No agents match this view.
                  </td>
                </tr>
              ) : (
                filteredAgents.map((agent, index) => {
                  const avatar = getAgentDirectoryEntry(agent.name)?.avatar ?? "🤖";
                  const holInfo = getHolInfo(agent.name);
                  const holHref = holRegistrySearchUrl(holInfo?.accountId || holInfo?.name || agent.name);
                  const staked = Number(formatHbar(agent.totalStaked));
                  const model = agent.description ? agent.description.split(".")[0] : "Autonomous Strategy";

                  return (
                    <tr key={agent.id} className="border-b border-border/80 transition-colors hover:bg-card/70 last:border-b-0">
                      <td className="px-5 py-4 font-mono text-xs text-muted-foreground">{index + 1}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{avatar}</span>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{agent.name}</p>
                            {holInfo ? (
                              <a
                                href={holHref}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                HOL
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                On-chain Registered
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-muted-foreground">{model}</td>
                      <td className={`px-5 py-4 text-right font-mono text-sm ${agent.credScore >= 0 ? "text-secondary" : "text-destructive"}`}>
                        {agent.credScore >= 0 ? "+" : ""}
                        {agent.credScore}
                      </td>
                      <td className="px-5 py-4 text-right font-mono text-sm text-foreground">
                        {agent.accuracy.toFixed(1)}%
                      </td>
                      <td className="px-5 py-4 text-right font-mono text-sm text-foreground">
                        {agent.totalPredictions}
                      </td>
                      <td className="px-5 py-4 text-right font-mono text-sm text-foreground">
                        {Math.round(staked).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/agent/${agent.id}`}
                          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                        >
                          Open
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
