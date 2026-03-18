"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAgent } from "@/hooks/useAgents";
import { useAgentRegistrationProof } from "@/hooks/useAgentProofs";
import { useIntelligenceTimeline } from "@/hooks/useIntelligenceTimeline";
import { useResolvedTransactionLinks } from "@/hooks/useResolvedTransactionLinks";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { formatHbar } from "@/lib/hedera";
import type { TimelineEvent } from "@/lib/types";
import { hashscanAddressUrl, hashscanTopicUrl } from "@/lib/explorer";

interface AgentSignalRow {
  key: string;
  roundId?: number;
  direction: "UP" | "DOWN" | "UNKNOWN";
  confidence: number | null;
  timestampIso: string;
  proofHref: string | null;
  proofLabel: "Tx" | "Topic" | null;
}

interface AgentProtocolSignal {
  roundId?: number;
  direction: "UP" | "DOWN" | "UNKNOWN";
  confidence: number | null;
  timestamp: string;
  reasoning: string;
  summary: string;
  txHash?: string;
  hashscanUrl?: string;
}

function useAgentSignals(agentId: number, limit: number = 220) {
  return useQuery({
    queryKey: ["agent-signals", agentId, limit],
    queryFn: async (): Promise<AgentProtocolSignal[]> => {
      if (!Number.isFinite(agentId) || agentId <= 0) return [];
      const response = await fetch(`/api/protocol/agent/${agentId}/signals?limit=${limit}`, {
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load agent signals");
      }
      const rawSignals = Array.isArray(data?.signals) ? data.signals : [];
      return rawSignals
        .map((signal: any) => {
          const timestamp = typeof signal?.timestamp === "string" ? signal.timestamp : "";
          if (!timestamp) return null;
          return {
            roundId: Number.isFinite(Number(signal?.roundId)) ? Number(signal.roundId) : undefined,
            direction:
              signal?.direction === "UP" || signal?.direction === "DOWN"
                ? signal.direction
                : "UNKNOWN",
            confidence:
              typeof signal?.confidence === "number" ? signal.confidence : null,
            timestamp,
            reasoning: typeof signal?.reasoning === "string" ? signal.reasoning : "",
            summary: typeof signal?.summary === "string" ? signal.summary : "",
            txHash:
              typeof signal?.txHash === "string" && signal.txHash.length > 0
                ? signal.txHash
                : undefined,
            hashscanUrl:
              typeof signal?.hashscanUrl === "string" && signal.hashscanUrl.length > 0
                ? signal.hashscanUrl
                : undefined,
          } satisfies AgentProtocolSignal;
        })
        .filter(
          (signal: AgentProtocolSignal | null): signal is AgentProtocolSignal =>
            signal !== null,
        );
    },
    enabled: Number.isFinite(agentId) && agentId > 0,
    refetchInterval: 15_000,
  });
}

function strategyFromName(name: string): string {
  const mapping: Record<string, string> = {
    sentinel: "Technical Analysis",
    pulse: "Sentiment",
    meridian: "Mean Reversion",
    oracle: "Meta-AI",
  };
  return mapping[name.toLowerCase()] || "Autonomous Strategy";
}

function formatUtcTime(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function AgentProfile() {
  const params = useParams();
  const idStr = typeof params?.id === "string" ? params.id : "";
  const agentIdNum = Number.parseInt(idStr, 10);

  const { data: agent, isLoading: isAgentLoading } = useAgent(agentIdNum);
  const { data: signals = [], isLoading: isSignalsLoading } = useAgentSignals(agentIdNum, 220);
  const { data: registrationTxHash = null } = useAgentRegistrationProof(agentIdNum);
  const { data: timelineEvents = [] } = useIntelligenceTimeline(
    220,
    agent?.name ? { agentName: agent.name } : undefined,
  );
  const signalTxHashes = useMemo(
    () =>
      signals
        .map((signal) => signal.txHash || null)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    [signals],
  );
  const timelineTxHashes = useMemo(
    () =>
      timelineEvents
        .map((event) => event.transactionHash || null)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    [timelineEvents],
  );
  const resolvedTxInputs = useMemo(
    () => [...timelineTxHashes, ...signalTxHashes, registrationTxHash],
    [timelineTxHashes, signalTxHashes, registrationTxHash],
  );
  const { getTransactionUrl } = useResolvedTransactionLinks(resolvedTxInputs);
  const [ownerHref, setOwnerHref] = useState<string | null>(null);
  const [registryHref, setRegistryHref] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const address = CONTRACT_ADDRESSES.agentRegistry;
    if (!address) {
      setRegistryHref(null);
      return;
    }

    fetch(`/api/mirror/entities/resolve?kind=contract&id=${encodeURIComponent(address)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data?.hashscanUrl === "string" && data.hashscanUrl.length > 0) {
          setRegistryHref(data.hashscanUrl);
          return;
        }
        setRegistryHref(hashscanAddressUrl(address));
      })
      .catch(() => {
        if (!cancelled) setRegistryHref(hashscanAddressUrl(address));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!agent?.owner) {
      setOwnerHref(null);
      return;
    }

    fetch(`/api/mirror/entities/resolve?kind=account&id=${encodeURIComponent(agent.owner)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data?.hashscanUrl === "string" && data.hashscanUrl.length > 0) {
          setOwnerHref(data.hashscanUrl);
          return;
        }
        setOwnerHref(hashscanAddressUrl(agent.owner));
      })
      .catch(() => {
        if (!cancelled) setOwnerHref(hashscanAddressUrl(agent.owner));
      });

    return () => {
      cancelled = true;
    };
  }, [agent?.owner]);

  const timelineProofHref = useCallback(
    (event?: TimelineEvent): string | null => {
      if (!event) return null;
      if (event.transactionHash) return getTransactionUrl(event.transactionHash);
      if (event.topicId) return hashscanTopicUrl(event.topicId);
      return null;
    },
    [getTransactionUrl],
  );
  const timelineProofMeta = useCallback(
    (event?: TimelineEvent): { href: string; label: "Tx" | "Topic" } | null => {
      if (!event) return null;
      if (event.transactionHash) {
        const href = getTransactionUrl(event.transactionHash);
        return href ? { href, label: "Tx" } : null;
      }
      if (event.topicId) return { href: hashscanTopicUrl(event.topicId), label: "Topic" };
      return null;
    },
    [getTransactionUrl],
  );

  const roundProofByRound = useMemo(() => {
    const map = new Map<number, string>();
    const prioritized = [...timelineEvents]
      .filter((event) => event.roundId != null)
      .sort((a, b) => {
        const aWeight = a.eventType === "PREDICTION_REVEALED" ? 0 : 1;
        const bWeight = b.eventType === "PREDICTION_REVEALED" ? 0 : 1;
        if (aWeight !== bWeight) return aWeight - bWeight;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

    for (const event of prioritized) {
      const roundId = event.roundId;
      if (roundId == null || map.has(roundId)) continue;
      const href = timelineProofHref(event);
      if (href) map.set(roundId, href);
    }

    return map;
  }, [timelineEvents, timelineProofHref]);

  const signalRows = useMemo((): AgentSignalRow[] => {
    const rows = signals.map((signal, index) => {
      const txProof = signal.hashscanUrl ?? getTransactionUrl(signal.txHash);
      const roundProof = signal.roundId != null ? roundProofByRound.get(signal.roundId) : null;
      return {
        key: `${signal.roundId ?? "x"}-${signal.timestamp}-${index}`,
        roundId: signal.roundId,
        direction: signal.direction,
        confidence: signal.confidence,
        timestampIso: signal.timestamp,
        proofHref: txProof ?? roundProof ?? null,
        proofLabel: txProof ? "Tx" : roundProof ? "Topic" : null,
      } satisfies AgentSignalRow;
    });

    rows.sort((a, b) => new Date(b.timestampIso).getTime() - new Date(a.timestampIso).getTime());
    return rows.slice(0, 40);
  }, [signals, getTransactionUrl, roundProofByRound]);

  const sortedTimeline = useMemo(() => {
    const events = [...timelineEvents];
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return events.slice(0, 40);
  }, [timelineEvents]);

  if (isAgentLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="h-8 w-8 animate-spin text-secondary" />
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Loading agent terminal...
        </p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="terminal-surface mx-auto max-w-3xl p-8 text-center">
        <p className="font-display text-2xl uppercase tracking-[-0.02em] text-foreground">Agent Not Found</p>
        <p className="mt-2 text-sm text-muted-foreground">No on-chain profile is available for this agent ID.</p>
        <Link
          href="/agents"
          className="mt-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
        >
          Back to Agents
        </Link>
      </div>
    );
  }

  const strategy = strategyFromName(agent.name);
  const totalStaked = Number(formatHbar(agent.totalStaked));
  const registrationTxHref = registrationTxHash ? getTransactionUrl(registrationTxHash) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-16 md:space-y-10">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Agents
      </Link>

      <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-kicker">Agent Terminal</p>
            <h1 className="section-title mt-1">{agent.name}</h1>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Agent #{agent.id} • {strategy}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${agent.active ? "border-secondary/40 bg-secondary/10 text-secondary" : "border-border bg-card text-muted-foreground"}`}>
              {agent.active ? "Active" : "Inactive"}
            </span>
            <Link
              href="/staking"
              className="rounded-sm border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground hover:border-secondary/50 hover:text-secondary"
            >
              Stake on Agent
            </Link>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">{agent.description}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {registryHref ? (
            <a
              href={registryHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              AgentRegistry Contract
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {ownerHref ? (
            <a
              href={ownerHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              Owner
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {registrationTxHref ? (
            <a
              href={registrationTxHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              Registration Tx
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <div className="terminal-surface px-4 py-4 md:px-5 md:py-5">
          <p className="terminal-heading">CredScore</p>
          <p className={`mt-3 font-mono text-3xl font-semibold tracking-tight md:text-[34px] ${agent.credScore >= 0 ? "text-secondary" : "text-destructive"}`}>
            {agent.credScore >= 0 ? "+" : ""}
            {agent.credScore}
          </p>
        </div>
        <div className="terminal-surface px-4 py-4 md:px-5 md:py-5">
          <p className="terminal-heading">Accuracy</p>
          <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-foreground md:text-[34px]">
            {agent.accuracy.toFixed(1)}%
          </p>
        </div>
        <div className="terminal-surface px-4 py-4 md:px-5 md:py-5">
          <p className="terminal-heading">Predictions</p>
          <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-foreground md:text-[34px]">
            {agent.totalPredictions}
          </p>
        </div>
        <div className="terminal-surface px-4 py-4 md:px-5 md:py-5">
          <p className="terminal-heading">Total Staked</p>
          <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-foreground md:text-[34px]">
            {Math.round(totalStaked).toLocaleString()} HBAR
          </p>
        </div>
      </section>

      <section className="terminal-surface overflow-hidden">
        <div className="flex items-end justify-between border-b border-border px-5 py-4 md:px-6">
          <div>
            <p className="section-kicker">Signals</p>
            <p className="section-title mt-1">Prediction Trail</p>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            On-chain + HCS linked
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Round</th>
                <th className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Direction</th>
                <th className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Confidence</th>
                <th className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">UTC</th>
                <th className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Proof</th>
              </tr>
            </thead>
            <tbody>
              {isSignalsLoading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              ) : signalRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No prediction signals indexed for this agent yet.
                  </td>
                </tr>
              ) : (
                signalRows.map((row) => (
                  <tr key={row.key} className="border-b border-border/80 transition-colors hover:bg-card/70 last:border-b-0">
                    <td className="px-5 py-3 font-mono text-sm text-foreground">
                      {row.roundId != null ? (
                        <Link href={`/round/${row.roundId}`} className="hover:text-secondary">
                          #{row.roundId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`px-5 py-3 font-mono text-sm ${row.direction === "UP" ? "text-secondary" : row.direction === "DOWN" ? "text-destructive" : "text-muted-foreground"}`}>
                      {row.direction}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-sm text-foreground">
                      {row.confidence != null ? `${row.confidence.toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-sm text-muted-foreground">
                      {formatUtcTime(row.timestampIso)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {row.proofHref ? (
                        <a
                          href={row.proofHref}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                        >
                          {row.proofLabel ?? "Link"}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
        <div className="mb-4 flex items-end justify-between border-b border-border pb-4">
          <div>
            <p className="section-kicker">Consensus Trail</p>
            <p className="section-title mt-1">Event Log</p>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">HCS + EVM</p>
        </div>

        <div className="space-y-1 rounded-sm border border-border bg-card p-3">
          {sortedTimeline.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No timeline events for this agent yet.</p>
          ) : (
            sortedTimeline.map((event) => {
              const proof = timelineProofMeta(event);
              return (
                <div
                  key={event.id}
                  className="grid grid-cols-[88px_1fr_auto] items-start gap-3 border-b border-border/70 py-2 last:border-b-0"
                >
                  <p className="font-mono text-[11px] text-muted-foreground">{formatUtcTime(event.timestamp)}</p>
                  <p className="font-mono text-[12px] text-foreground">{event.message}</p>
                  {proof?.href ? (
                    <a
                      href={proof.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                    >
                      {proof.label}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      —
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
