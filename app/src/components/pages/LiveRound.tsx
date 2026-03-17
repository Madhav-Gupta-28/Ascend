"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink, Gauge, Loader2 } from "lucide-react";
import { useMemo } from "react";
import RoundTimer from "@/components/RoundTimer";
import { useCurrentRound, useRound, useCommitments } from "@/hooks/useRounds";
import { useAgents } from "@/hooks/useAgents";
import { useIntelligenceTimeline } from "@/hooks/useIntelligenceTimeline";
import { useResolvedTransactionLinks } from "@/hooks/useResolvedTransactionLinks";
import type { Agent, Commitment, Round, TimelineEvent } from "@/lib/types";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";
import { hashscanTopicUrl } from "@/lib/explorer";

interface LiveRoundProps {
  roundId?: number;
}

function formatPrice(value?: number): string {
  if (value == null || Number.isNaN(value)) return "--";
  return `$${value.toFixed(4)}`;
}

function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function roundPhase(status: Round["status"]): "committing" | "revealing" | "resolved" | "cancelled" {
  if (status === 0) return "committing";
  if (status === 1) return "revealing";
  if (status === 2) return "resolved";
  return "cancelled";
}

function statusLabel(round: Round): string {
  if (round.status === 2) return `Resolved ${round.outcome === 0 ? "UP" : "DOWN"}`;
  if (round.status === 1) return "Revealing";
  if (round.status === 0) return "Committing";
  return "Cancelled";
}

function outcomeDirection(round: Round): "UP" | "DOWN" {
  return round.outcome === 0 ? "UP" : "DOWN";
}

function directionFromCommitment(commitment?: Commitment): "UP" | "DOWN" | null {
  if (!commitment?.revealed) return null;
  return commitment.direction === 0 ? "UP" : "DOWN";
}

function resolvedAgents(agents: Agent[], commitments: Record<number, Commitment>): Agent[] {
  const participants = agents.filter(
    (agent) => commitments[agent.id]?.committed || commitments[agent.id]?.revealed
  );
  if (participants.length > 0) return participants;
  return agents.filter((agent) => agent.active).sort((a, b) => a.id - b.id).slice(0, 4);
}

export default function LiveRound({ roundId }: LiveRoundProps) {
  const { data: currentRound, isLoading: currentRoundLoading } = useCurrentRound();
  const targetRoundId = roundId ?? currentRound?.id ?? 0;
  const { data: fetchedRound, isLoading: fetchedRoundLoading } = useRound(targetRoundId);
  const { data: agents = [] } = useAgents();

  const round = roundId ? fetchedRound : fetchedRound ?? currentRound;
  const roundLoading = roundId ? fetchedRoundLoading : currentRoundLoading || (targetRoundId > 0 && fetchedRoundLoading && !fetchedRound);

  const agentIds = useMemo(() => agents.map((agent) => Number(agent.id)), [agents]);
  const { data: commitments = {} } = useCommitments(round?.id || 0, agentIds, round?.status);
  const { data: timelineEvents = [] } = useIntelligenceTimeline(140, round?.id ? { roundId: round.id } : undefined);
  const txHashes = useMemo(
    () =>
      timelineEvents
        .map((event) => event.transactionHash || null)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    [timelineEvents],
  );
  const { getTransactionUrl } = useResolvedTransactionLinks(txHashes);

  if (roundLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="h-8 w-8 animate-spin text-secondary" />
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Loading round terminal...
        </p>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="terminal-surface mx-auto max-w-3xl p-8 text-center">
        <Gauge className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-4 font-display text-2xl uppercase tracking-[-0.02em] text-foreground">No Rounds Yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Start an orchestrated round to activate the live intelligence arena.
        </p>
      </div>
    );
  }

  const currentPrice = round.endPrice > 0 ? round.endPrice : round.startPrice;
  const delta = currentPrice - round.startPrice;
  const deltaPct = round.startPrice > 0 ? (delta / round.startPrice) * 100 : 0;
  const isPositive = delta >= 0;

  const roundEventsAsc = [...timelineEvents]
    .filter((event) => event.roundId === round.id)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const roundEventsDesc = [...roundEventsAsc].reverse();

  const proofHref = (event?: TimelineEvent): string | null => {
    if (!event) return null;
    if (event.transactionHash) return getTransactionUrl(event.transactionHash);
    if (event.topicId) return hashscanTopicUrl(event.topicId);
    return null;
  };

  const createdEvents = roundEventsAsc.filter((event) => event.eventType === "COMMIT_PHASE_STARTED");
  const createdEvent = createdEvents[0];
  const createdTxEvent = createdEvents.find((event) => Boolean(event.transactionHash));

  const resolvedEvents = roundEventsDesc.filter((event) => event.eventType === "ROUND_RESOLVED");
  const resolvedEvent = resolvedEvents[0];
  const resolvedTxEvent = resolvedEvents.find((event) => Boolean(event.transactionHash));
  const resolvedTxHref = resolvedTxEvent?.transactionHash
    ? getTransactionUrl(resolvedTxEvent.transactionHash)
    : null;

  const oracleSourceEvent = resolvedTxEvent ?? createdTxEvent ?? resolvedEvent ?? createdEvent;
  const openPriceHref = proofHref(createdTxEvent ?? createdEvent);
  const closePriceHref = resolvedTxHref ?? proofHref(resolvedEvent);
  const oracleHref = resolvedTxHref ?? proofHref(oracleSourceEvent);

  const timerPhase = roundPhase(round.status);
  const timerEnd =
    round.status === 0
      ? round.commitDeadline
      : round.status === 1
        ? round.revealDeadline
        : round.resolveAfter;

  const displayedAgents = resolvedAgents(agents, commitments);
  const resolvedDirection = round.status === 2 ? outcomeDirection(round) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-16 md:space-y-10">
      <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-kicker">Round Terminal</p>
            <h1 className="section-title mt-1">Round #{round.id}</h1>
            {round.status === 2 && resolvedTxHref ? (
              <a
                href={resolvedTxHref}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
              >
                {statusLabel(round)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {statusLabel(round)}
              </p>
            )}
          </div>

          <div className="flex flex-col items-start gap-2 md:items-end">
            <RoundTimer endTime={timerEnd} phase={timerPhase} />
            {resolvedTxHref ? (
              <a
                href={resolvedTxHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
              >
                Resolve Tx
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="rounded-sm border border-border bg-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Asset: HBAR / USD</p>
              {oracleHref ? (
                <a
                  href={oracleHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                >
                  Oracle Data
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Oracle Data</span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="section-kicker">Open Price</p>
                {openPriceHref ? (
                  <a href={openPriceHref} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-mono text-2xl text-foreground hover:text-secondary">
                    {formatPrice(round.startPrice)}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <p className="mt-1 font-mono text-2xl text-foreground">{formatPrice(round.startPrice)}</p>
                )}
              </div>
              <div>
                <p className="section-kicker">{round.status === 2 ? "Closing Price" : "Current Price"}</p>
                {closePriceHref ? (
                  <a
                    href={closePriceHref}
                    target="_blank"
                    rel="noreferrer"
                    className={`mt-1 inline-flex items-center gap-1 font-mono text-2xl ${isPositive ? "text-secondary" : "text-destructive"} hover:opacity-80`}
                  >
                    {formatPrice(currentPrice)}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <p className={`mt-1 font-mono text-2xl ${isPositive ? "text-secondary" : "text-destructive"}`}>
                    {formatPrice(currentPrice)}
                  </p>
                )}
              </div>
              <div>
                <p className="section-kicker">Delta</p>
                <p className={`mt-1 inline-flex items-center gap-1 font-mono text-2xl ${isPositive ? "text-secondary" : "text-destructive"}`}>
                  {isPositive ? <ArrowUp className="h-5 w-5" /> : <ArrowDown className="h-5 w-5" />}
                  {`${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%`}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-sm border border-border bg-card p-4">
            <p className="section-kicker">Round Status</p>
            {round.status === 2 && resolvedTxHref ? (
              <a
                href={resolvedTxHref}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 font-display text-xl uppercase tracking-[-0.018em] text-secondary hover:text-secondary/85"
              >
                {`Resolved ${outcomeDirection(round)}`}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="mt-2 font-display text-xl uppercase tracking-[-0.018em] text-foreground">
                {statusLabel(round)}
              </p>
            )}
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {round.revealedCount} / {round.participantCount} revealed
            </p>
            <div className="mt-4 border-t border-border pt-3">
              <Link
                href="/rounds"
                className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                View All Rounds
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
          <div>
            <p className="section-kicker">Agent Outcomes</p>
            <p className="section-title mt-1">Resolved Positions</p>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Round #{round.id}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {displayedAgents.map((agent) => {
            const commitment = commitments[agent.id];
            const direction = directionFromCommitment(commitment);
            const confidence = commitment?.revealed ? commitment.confidence : null;
            const isCorrect =
              resolvedDirection && direction ? direction === resolvedDirection : null;

            const revealEventsForAgent = roundEventsDesc.filter(
              (event) =>
                event.eventType === "PREDICTION_REVEALED" &&
                event.agentName?.toLowerCase() === agent.name.toLowerCase()
            );
            const revealEvent =
              revealEventsForAgent.find((event) => Boolean(event.transactionHash)) ??
              revealEventsForAgent[0];

            const commitEventsForAgent = roundEventsDesc.filter(
              (event) =>
                event.eventType === "PREDICTION_COMMITTED" &&
                event.agentName?.toLowerCase() === agent.name.toLowerCase()
            );
            const commitEvent =
              commitEventsForAgent.find((event) => Boolean(event.transactionHash)) ??
              commitEventsForAgent[0];
            const proof = proofHref(revealEvent) ?? proofHref(commitEvent);

            const avatar = getAgentDirectoryEntry(agent.name)?.avatar ?? "🤖";
            const cardTone =
              isCorrect === true
                ? "border-secondary/40 bg-secondary/5"
                : isCorrect === false
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border bg-card";

            return (
              <div key={agent.id} className={`rounded-sm border p-4 ${cardTone}`}>
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{avatar}</span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{agent.name}</p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        Agent #{agent.id}
                      </p>
                    </div>
                  </div>
                  {proof ? (
                    <a
                      href={proof}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                    >
                      Proof
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-border/80 pt-3">
                  <div>
                    <p className="section-kicker">Direction</p>
                    <p className={`mt-1 font-mono text-lg ${direction === "UP" ? "text-secondary" : direction === "DOWN" ? "text-destructive" : "text-muted-foreground"}`}>
                      {direction ?? "HIDDEN"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="section-kicker">Confidence</p>
                    <p className="mt-1 font-mono text-lg text-foreground">
                      {confidence != null ? `${confidence}%` : "—"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
        <div className="mb-4 flex items-end justify-between border-b border-border pb-4">
          <div>
            <p className="section-kicker">Consensus Trail</p>
            <p className="section-title mt-1">Event Log</p>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            HCS + EVM
          </p>
        </div>

        <div className="space-y-1 rounded-sm border border-border bg-card p-3">
          {roundEventsDesc.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No round events indexed yet.</p>
          ) : (
            roundEventsDesc.slice(0, 30).map((event) => {
              const href = proofHref(event);
              return (
                <div key={event.id} className="grid grid-cols-[88px_1fr_auto] items-start gap-3 border-b border-border/70 py-2 last:border-b-0">
                  <p className="font-mono text-[11px] text-muted-foreground">{formatUtcTime(event.timestamp)}</p>
                  <p className="font-mono text-[12px] text-foreground">{event.message}</p>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                    >
                      Link
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
