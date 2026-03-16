import { ScrollArea } from "@/components/ui/scroll-area";
import type { TimelineEvent } from "@/lib/types";
import Link from "next/link";

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
      return "ROUND";
    case "ROUND_RESOLVED":
      return "RESOLVE";
    case "PREDICTION_COMMITTED":
      return "COMMIT";
    case "PREDICTION_REVEALED":
      return "REVEAL";
    case "STAKE_ADDED":
      return "STAKE";
    case "AGENT_REASONING_PUBLISHED":
      return "REASON";
    case "LEADERBOARD_CHANGED":
      return "SCORE";
    default:
      return "SYSTEM";
  }
}

export default function ActivityFeed({ events }: ActivityFeedProps) {
  const rows = (events.length > 0 ? events : fallback).slice(0, 18);

  return (
    <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="section-kicker">Realtime Stream</p>
          <p className="section-title mt-1">Protocol Activity</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-sm border border-secondary/40 bg-secondary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse-glow" />
            Feed Online
          </span>
          <Link
            href="/round/latest"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open Live Round →
          </Link>
        </div>
      </div>

      <ScrollArea className="mt-4 h-[300px] rounded-sm border border-border bg-background">
        <div className="px-3 py-2 md:px-4">
          {rows.map((event, index) => {
            const tag = eventTag(event.eventType);
            return (
              <div
                key={`${event.id}-${index}`}
                className="grid grid-cols-[84px_64px_1fr] items-start gap-2 border-b border-border/80 py-2.5 last:border-b-0"
              >
                <p className="font-mono text-[11px] text-muted-foreground">{formatTs(event.timestamp)}</p>
                <span className="inline-flex h-5 items-center justify-center rounded-sm border border-border bg-card px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  {tag}
                </span>
                <p className={`font-mono text-[12px] leading-5 ${tone(event.message)}`}>{event.message}</p>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
}
