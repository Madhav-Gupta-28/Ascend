"use client";

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

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (secs < 10) return "just now";
    if (secs < 60) return `${secs}s ago`;
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
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
    ROUND_CREATED: <Target className="h-4 w-4" />,
    COMMIT_PHASE_STARTED: <Send className="h-4 w-4" />,
    REVEAL_PHASE_STARTED: <Eye className="h-4 w-4" />,
    ROUND_RESOLVED: <Trophy className="h-4 w-4" />,
    AGENT_ANALYSIS_STARTED: <Brain className="h-4 w-4" />,
    AGENT_REASONING_PUBLISHED: <Zap className="h-4 w-4" />,
    PREDICTION_COMMITTED: <Send className="h-4 w-4" />,
    PREDICTION_REVEALED: <Eye className="h-4 w-4" />,
    STAKE_ADDED: <TrendingUp className="h-4 w-4" />,
    LEADERBOARD_CHANGED: <TrendingUp className="h-4 w-4" />,
};

const EVENT_COLORS: Record<TimelineEventType, string> = {
    ROUND_CREATED: "text-primary bg-primary/10 border-primary/20",
    COMMIT_PHASE_STARTED: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    REVEAL_PHASE_STARTED: "text-primary bg-primary/10 border-primary/20",
    ROUND_RESOLVED: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    AGENT_ANALYSIS_STARTED: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    AGENT_REASONING_PUBLISHED: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    PREDICTION_COMMITTED: "text-primary bg-primary/10 border-primary/20",
    PREDICTION_REVEALED: "text-primary bg-primary/10 border-primary/20",
    STAKE_ADDED: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    LEADERBOARD_CHANGED: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

function DetailBadge({ detail, eventType }: { detail: string; eventType: TimelineEventType }) {
    const isUp = detail.startsWith("UP") || detail === "UP";
    const isDown = detail.startsWith("DOWN") || detail === "DOWN";
    const isPositive = detail.startsWith("+");
    const isNegative = detail.startsWith("-") && !detail.startsWith("- ");
    if (isUp) return <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/30"><ArrowUp className="h-3 w-3" />{detail}</span>;
    if (isDown) return <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400 border border-red-500/30"><ArrowDown className="h-3 w-3" />{detail}</span>;
    if (isPositive) return <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-mono font-medium text-emerald-400 border border-emerald-500/30">{detail}</span>;
    if (isNegative) return <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-mono font-medium text-red-400 border border-red-500/30">{detail}</span>;
    return <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-border">{detail}</span>;
}

function TimelineEventCard({
    event,
    index,
}: {
    event: import("@/lib/types").TimelineEvent;
    index: number;
}) {
    const icon = EVENT_ICONS[event.eventType] ?? <Zap className="h-4 w-4" />;
    const color = EVENT_COLORS[event.eventType] ?? "text-muted-foreground bg-muted border-border";
    const mirrorUrl = event.topicId != null && event.sequenceNumber != null
        ? getMirrorMessageUrl(event.topicId, event.sequenceNumber)
        : "";
    const txUrl = event.transactionHash ? getHashScanTxUrl(event.transactionHash) : "";
    const verifiedHref = mirrorUrl || txUrl;

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.25 }}
            className="group rounded-xl border border-border/80 bg-card/60 p-4 transition-all hover:border-primary/25 hover:bg-card/80 hover:shadow-sm"
        >
            <div className="flex gap-4">
                <div className={`shrink-0 rounded-xl border p-2.5 ${color}`}>
                    {icon}
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                    <div>
                        <p className="text-[15px] font-semibold leading-snug text-foreground">
                            {event.message}
                        </p>
                        {event.detail && (
                            <div className="mt-2">
                                <DetailBadge detail={event.detail} eventType={event.eventType} />
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground/80" />
                            {timeAgo(event.timestamp)}
                        </span>
                        {verifiedHref && (
                            <a
                                href={verifiedHref}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 hover:border-primary/30"
                            >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Verified by Hedera
                            </a>
                        )}
                    </div>
                </div>
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

    return (
        <div className={compact ? "space-y-3" : "space-y-5"}>
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                    {title}
                </h2>
                {!isLoading && events.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Live
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
            ) : events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
                    <p className="text-sm font-medium text-muted-foreground">
                        No timeline events yet.
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground/80">
                        Run a round to see agents commit, reveal, and resolve live on Hedera.
                    </p>
                </div>
            ) : (
                <div className={`space-y-3 ${compact ? "max-h-[480px] overflow-y-auto pr-1 scroll-smooth" : ""}`}>
                    {events.map((event, i) => (
                        <TimelineEventCard key={event.id} event={event} index={i} />
                    ))}
                </div>
            )}
        </div>
    );
}
