"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Brain,
  Send,
  Eye,
  Trophy,
  TrendingUp,
  Target,
  Loader2,
  CheckCircle2,
  Clock,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useIntelligenceTimeline, type TimelineFilters } from "@/hooks/useIntelligenceTimeline";
import type { TimelineEventType } from "@/lib/types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function getMirrorMessageUrl(topicId: string, sequenceNumber: number): string {
  if (!topicId || sequenceNumber == null) return "";
  const base = process.env.NEXT_PUBLIC_HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com";
  return `${base}/api/v1/topics/${topicId}/messages/${sequenceNumber}`;
}

function getHashScanTxUrl(txHash: string): string {
  if (!txHash) return "";
  const network = process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet";
  return `https://hashscan.io/${network}/transaction/${txHash}`;
}

const EVENT_ICONS: Record<TimelineEventType, React.ReactNode> = {
  ROUND_CREATED: <Target className="h-3.5 w-3.5" />,
  COMMIT_PHASE_STARTED: <Send className="h-3.5 w-3.5" />,
  REVEAL_PHASE_STARTED: <Eye className="h-3.5 w-3.5" />,
  ROUND_RESOLVED: <Trophy className="h-3.5 w-3.5" />,
  AGENT_ANALYSIS_STARTED: <Brain className="h-3.5 w-3.5" />,
  AGENT_REASONING_PUBLISHED: <Zap className="h-3.5 w-3.5" />,
  PREDICTION_COMMITTED: <Send className="h-3.5 w-3.5" />,
  PREDICTION_REVEALED: <Eye className="h-3.5 w-3.5" />,
  STAKE_ADDED: <TrendingUp className="h-3.5 w-3.5" />,
  LEADERBOARD_CHANGED: <TrendingUp className="h-3.5 w-3.5" />,
};

// Terminal color coding:
// analysis = blue, commit = amber, reveal = purple, resolve = green
const EVENT_COLORS: Record<TimelineEventType, string> = {
  ROUND_CREATED: "text-amber-300",
  COMMIT_PHASE_STARTED: "text-amber-300",
  REVEAL_PHASE_STARTED: "text-purple-300",
  ROUND_RESOLVED: "text-emerald-300",
  AGENT_ANALYSIS_STARTED: "text-sky-300",
  AGENT_REASONING_PUBLISHED: "text-sky-300",
  PREDICTION_COMMITTED: "text-amber-300",
  PREDICTION_REVEALED: "text-purple-300",
  STAKE_ADDED: "text-emerald-300",
  LEADERBOARD_CHANGED: "text-emerald-300",
};

function DetailBadge({ detail }: { detail: string }) {
  const isUp = detail.startsWith("UP") || detail === "UP";
  const isDown = detail.startsWith("DOWN") || detail === "DOWN";
  const isPositive = detail.startsWith("+");
  const isNegative = detail.startsWith("-") && !detail.startsWith("- ");
  if (isUp)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400">
        <ArrowUp className="h-3 w-3" />
        {detail}
      </span>
    );
  if (isDown)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-red-400">
        <ArrowDown className="h-3 w-3" />
        {detail}
      </span>
    );
  if (isPositive)
    return <span className="text-[11px] font-mono text-emerald-400">{detail}</span>;
  if (isNegative)
    return <span className="text-[11px] font-mono text-red-400">{detail}</span>;
  return <span className="text-[11px] font-mono text-muted-foreground">{detail}</span>;
}

function TimelineEventCard({
  event,
  index,
}: {
  event: import("@/lib/types").TimelineEvent;
  index: number;
}) {
  const mirrorUrl =
    event.topicId != null && event.sequenceNumber != null
      ? getMirrorMessageUrl(event.topicId, event.sequenceNumber)
      : "";
  const txUrl = event.transactionHash ? getHashScanTxUrl(event.transactionHash) : "";
  const verifiedHref = mirrorUrl || txUrl;

  const timestamp = formatTime(event.timestamp);
  const mainLine = event.message;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.25), duration: 0.2 }}
      className="font-mono text-[11px] text-foreground/90"
    >
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground/80">[{timestamp}]</span>
        <span className="truncate">
          {mainLine}
          {event.detail && (
            <>
              {" "}
              <DetailBadge detail={event.detail} />
            </>
          )}
          {verifiedHref && (
            <>
              {" "}
              <a
                href={verifiedHref}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-primary/80 hover:text-primary underline underline-offset-2"
              >
                (proof)
              </a>
            </>
          )}
        </span>
      </div>
    </motion.div>
  );
}

export interface IntelligenceTimelineProps {
  limit?: number;
  filters?: TimelineFilters;
  title?: string;
  /** Show compact single-column feed (e.g. sidebar) */
  compact?: boolean;
}

export default function IntelligenceTimeline({
  limit = 40,
  filters,
  title = "Intelligence Timeline",
  compact = false,
}: IntelligenceTimelineProps) {
  const { data: events = [], isLoading, error } = useIntelligenceTimeline(limit, filters);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const hasEvents = events.length > 0;

  useEffect(() => {
    if (!hasEvents || compact) return;
    if (!containerRef.current) return;
    containerRef.current.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [hasEvents, compact, events.length]);

  const wrapperClasses = useMemo(
    () => (compact ? "space-y-3" : "space-y-5"),
    [compact],
  );

  return (
    <div className={wrapperClasses}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
          {title}
        </h2>
        {!isLoading && hasEvents && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Could not load timeline. Check HCS topic configuration.
        </div>
      ) : !hasEvents ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            No timeline events yet.
          </p>
          <p className="mt-2 text-xs text-muted-foreground/80">
            Run a round to see agents commit, reveal, and resolve live on Hedera.
          </p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className={`space-y-1.5 max-h-[480px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent`}
        >
          {events.map((event, i) => (
            <TimelineEventCard key={event.id} event={event} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
