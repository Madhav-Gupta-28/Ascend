import { ScrollArea } from "@/components/ui/scroll-area";
import type { TimelineEvent } from "@/lib/types";
import Link from "next/link";
import { ExternalLink, Brain } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useResolvedTransactionLinks } from "@/hooks/useResolvedTransactionLinks";
import { hashscanTopicUrl } from "@/lib/explorer";

interface ActivityFeedProps {
  events: TimelineEvent[];
}

const fallback: TimelineEvent[] = [
  {
    id: "fallback-1",
    eventType: "LEADERBOARD_CHANGED",
    message: "Sentinel CredScore -70",
    timestamp: "2026-03-16T15:58:41.000Z",
  },
  {
    id: "fallback-2",
    eventType: "LEADERBOARD_CHANGED",
    message: "Meridian CredScore -74",
    timestamp: "2026-03-16T15:58:44.000Z",
  },
  {
    id: "fallback-3",
    eventType: "ROUND_CREATED",
    message: "Round #842 opened HBAR/USD",
    timestamp: "2026-03-16T15:59:02.000Z",
  },
  {
    id: "fallback-4",
    eventType: "PREDICTION_COMMITTED",
    message: "Pulse committed prediction",
    timestamp: "2026-03-16T15:59:17.000Z",
  },
  {
    id: "fallback-5",
    eventType: "AGENT_REASONING_PUBLISHED",
    message: "Oracle reasoning submitted",
    timestamp: "2026-03-16T15:59:33.000Z",
  },
];

function formatTs(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}]`;
}

function tone(message: string): string {
  if (message.includes("DOWN") || message.includes(" -")) return "text-destructive";
  if (message.includes("UP") || message.includes(" +") || message.includes("committed")) return "text-secondary";
  return "text-foreground";
}

function eventTag(type: TimelineEvent["eventType"]): string {
  switch (type) {
    case "ROUND_CREATED":
    case "COMMIT_PHASE_STARTED":
      return "ROUND";
    case "ROUND_RESOLVED":
      return "RESOLVE";
    case "PREDICTION_COMMITTED":
      return "COMMIT";
    case "PREDICTION_REVEALED":
    case "REVEAL_PHASE_STARTED":
      return "REVEAL";
    case "STAKE_ADDED":
      return "STAKE";
    case "AGENT_REASONING_PUBLISHED":
    case "AGENT_ANALYSIS_STARTED":
      return "HCS";
    case "LEADERBOARD_CHANGED":
      return "SCORE";
    default:
      return "SYSTEM";
  }
}

function tagColor(tag: string): string {
  switch (tag) {
    case "HCS":
      return "border-blue-500/50 bg-blue-500/15 text-blue-400";
    case "RESOLVE":
      return "border-amber-500/50 bg-amber-500/15 text-amber-400";
    case "SCORE":
      return "border-purple-500/50 bg-purple-500/15 text-purple-400";
    case "ROUND":
      return "border-secondary/50 bg-secondary/15 text-secondary";
    default:
      return "border-border bg-card text-muted-foreground";
  }
}

function isReasoningEvent(type: TimelineEvent["eventType"]): boolean {
  return type === "AGENT_REASONING_PUBLISHED" || type === "AGENT_ANALYSIS_STARTED";
}

function highlightAgentMessage(message: string, agentName?: string): React.ReactNode {
  const normalizedAgent = String(agentName || "").trim();
  if (!normalizedAgent) return message;

  const lowerMessage = message.toLowerCase();
  const lowerAgent = normalizedAgent.toLowerCase();
  const index = lowerMessage.indexOf(lowerAgent);
  if (index < 0) return message;

  const before = message.slice(0, index);
  const exact = message.slice(index, index + normalizedAgent.length);
  const after = message.slice(index + normalizedAgent.length);

  return (
    <>
      {before}
      <span className="font-semibold text-foreground">{exact}</span>
      {after}
    </>
  );
}

export default function ActivityFeed({ events }: ActivityFeedProps) {
  const [mounted, setMounted] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);

  const rows = useMemo(
    () => (mounted ? (events.length > 0 ? events : fallback) : fallback).slice(0, 18),
    [mounted, events],
  );
  const txHashes = useMemo(
    () =>
      rows
        .map((event) => event.transactionHash || null)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    [rows],
  );
  const { getTransactionUrl } = useResolvedTransactionLinks(txHashes);

  const isStreaming = useMemo(() => {
    if (!mounted || !nowMs || events.length === 0) return false;
    const newest = new Date(events[0].timestamp).getTime();
    if (!Number.isFinite(newest)) return false;
    return nowMs - newest <= 90_000;
  }, [mounted, nowMs, events]);

  useEffect(() => {
    if (!mounted) return;
    const viewport = scrollContainerRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement | null;
    if (!viewport) return;
    viewport.scrollTo({ top: 0, behavior: "smooth" });
  }, [mounted, rows[0]?.id]);

  return (
    <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="section-kicker">Hedera Consensus Service</p>
          <p className="section-title mt-1">On-Chain Activity Stream</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
              isStreaming
                ? "border-secondary/40 bg-secondary/10 text-secondary"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isStreaming ? "bg-secondary animate-pulse-glow" : "bg-muted-foreground"
              }`}
            />
            {isStreaming ? "HCS Streaming" : "Awaiting Stream"}
          </span>
          <Link
            href="/round/latest"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open Live Round →
          </Link>
        </div>
      </div>

      <div ref={scrollContainerRef}>
        <ScrollArea className="mt-4 h-[300px] rounded-sm border border-border bg-background">
          <div className="px-3 py-2 md:px-4">
            {rows.map((event, index) => {
              const tag = eventTag(event.eventType);
              const colorCls = tagColor(tag);
              const isReasoning = isReasoningEvent(event.eventType);
              const proofMeta = event.transactionHash
                ? {
                    href: getTransactionUrl(event.transactionHash),
                    label: "Tx" as const,
                  }
                : event.topicId
                  ? {
                      href: hashscanTopicUrl(event.topicId),
                      label: "HCS" as const,
                    }
                  : null;
              return (
                <div
                  key={`${event.id}-${index}`}
                  className={`border-b border-border/80 py-2.5 last:border-b-0 ${isReasoning ? "rounded-sm bg-blue-500/[0.04]" : ""}`}
                >
                  <div className="grid grid-cols-[84px_56px_1fr_auto] items-start gap-2">
                    <p className="font-mono text-[11px] text-muted-foreground">{formatTs(event.timestamp)}</p>
                    <span className={`inline-flex h-5 items-center justify-center rounded-sm border px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] ${colorCls}`}>
                      {tag}
                    </span>
                    <p className={`font-mono text-[12px] leading-5 ${tone(event.message)}`}>
                      {isReasoning && <Brain className="mr-1.5 inline-block h-3 w-3 text-blue-400" />}
                      {highlightAgentMessage(event.message, event.agentName)}
                    </p>
                    {proofMeta?.href ? (
                      <a
                        href={proofMeta.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                      >
                        {proofMeta.label}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        —
                      </span>
                    )}
                  </div>
                  {isReasoning && event.detail && (
                    <div className="ml-[140px] mt-1">
                      <span className="font-mono text-[10px] text-blue-400/70">
                        confidence: {event.detail}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </section>
  );
}
