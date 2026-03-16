"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { useRoundsHistory } from "@/hooks/useRounds";
import { useIntelligenceTimeline } from "@/hooks/useIntelligenceTimeline";
import type { Round } from "@/lib/types";

function statusText(round: Round): string {
  if (round.status === 0) return "Committing";
  if (round.status === 1) return "Revealing";
  if (round.status === 2) return `Resolved ${round.outcome === 0 ? "UP" : "DOWN"}`;
  return "Cancelled";
}

function statusClasses(round: Round): string {
  if (round.status === 0 || round.status === 1) {
    return "border-secondary/35 bg-secondary/10 text-secondary";
  }
  if (round.status === 2 && round.outcome === 0) {
    return "border-secondary/35 bg-secondary/10 text-secondary";
  }
  if (round.status === 2 && round.outcome === 1) {
    return "border-destructive/35 bg-destructive/10 text-destructive";
  }
  return "border-border bg-card text-muted-foreground";
}

function hashscanTxUrl(txHash: string): string {
  const network = process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet";
  return `https://hashscan.io/${network}/transaction/${txHash}`;
}

function price(value: number): string {
  return `$${value.toFixed(4)}`;
}

export default function RoundsHistory() {
  const router = useRouter();
  const { data: rounds = [], isLoading } = useRoundsHistory(150);
  const { data: timelineEvents = [] } = useIntelligenceTimeline(600);

  const resolvedTxByRoundId = useMemo(() => {
    const map = new Map<number, string>();
    for (const event of timelineEvents) {
      if (event.eventType === "ROUND_RESOLVED" && event.roundId != null && event.transactionHash) {
        if (!map.has(event.roundId)) {
          map.set(event.roundId, event.transactionHash);
        }
      }
    }
    return map;
  }, [timelineEvents]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="h-8 w-8 animate-spin text-secondary" />
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Loading rounds history...
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
        <p className="section-kicker">Round Archive</p>
        <h1 className="section-title mt-1">All Rounds</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Complete history of intelligence rounds, statuses, outcomes, and proofs.
        </p>
      </section>

      <section className="terminal-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Round</th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Open</th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Close</th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Participants</th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Revealed</th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rounds.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No rounds found on-chain yet.
                  </td>
                </tr>
              ) : (
                rounds.map((round) => {
                  const txHash = resolvedTxByRoundId.get(round.id);
                  const actionLabel =
                    round.status === 0 || round.status === 1
                      ? "Track"
                      : round.status === 2
                        ? "Review"
                        : "View";
                  return (
                    <tr
                      key={round.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/round/${round.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/round/${round.id}`);
                        }
                      }}
                      className="cursor-pointer border-b border-border/80 transition-colors hover:bg-card/60 focus-visible:bg-card/70 last:border-b-0"
                    >
                      <td className="px-4 py-3 font-mono text-sm text-foreground">#{round.id}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${statusClasses(round)}`}>
                          {statusText(round)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-foreground">{price(round.startPrice)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-foreground">
                        {round.endPrice > 0 ? price(round.endPrice) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-foreground">{round.participantCount}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-foreground">{round.revealedCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/round/${round.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                          >
                            {actionLabel}
                          </Link>
                          {txHash ? (
                            <a
                              href={hashscanTxUrl(txHash)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
                            >
                              Tx
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
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
