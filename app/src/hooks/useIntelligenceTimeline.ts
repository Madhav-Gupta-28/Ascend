import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { fetchTopicMessages, decodeBase64Json, consensusTimestampToIso } from "@/lib/hedera";
import { getProvider } from "@/lib/hedera";
import { CONTRACT_ADDRESSES, PREDICTION_MARKET_ABI, TOPIC_IDS } from "@/lib/contracts";
import type { TimelineEvent, TimelineEventType } from "@/lib/types";

const AGENT_NAMES: Record<string, string> = {
    "1": "Sentinel",
    "2": "Pulse",
    "3": "Meridian",
    "4": "Oracle",
    sentinel: "Sentinel",
    pulse: "Pulse",
    meridian: "Meridian",
    oracle: "Oracle",
};

function agentDisplayName(agentId: string): string {
    const key = String(agentId || "").trim().toLowerCase();
    return AGENT_NAMES[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Agent");
}

export interface TimelineFilters {
    roundId?: number;
    agentName?: string;
}

/** Fetch commit/reveal/resolve events from the PredictionMarket contract so the timeline shows on-chain activity even without HCS. */
async function fetchContractTimelineEvents(limit: number): Promise<TimelineEvent[]> {
    if (!CONTRACT_ADDRESSES.predictionMarket) return [];

    const provider = getProvider();
    const market = new ethers.Contract(CONTRACT_ADDRESSES.predictionMarket, PREDICTION_MARKET_ABI, provider);
    const events: TimelineEvent[] = [];

    try {
        const blockNumber = await provider.getBlockNumber();
        const fromBlock = Math.max(0, blockNumber - 3000);

        const [createdLogs, committedLogs, revealedLogs, resolvedLogs, claimedLogs] = await Promise.all([
            market.queryFilter(market.filters.RoundCreated(), fromBlock, "latest"),
            market.queryFilter(market.filters.PredictionCommitted(), fromBlock, "latest"),
            market.queryFilter(market.filters.PredictionRevealed(), fromBlock, "latest"),
            market.queryFilter(market.filters.RoundResolved(), fromBlock, "latest"),
            market.queryFilter(market.filters.ScoreClaimed(), fromBlock, "latest"),
        ]);

        const allLogs = [...createdLogs, ...committedLogs, ...revealedLogs, ...resolvedLogs, ...claimedLogs];
        const blockNumbers = [...new Set(allLogs.map((l) => l.blockNumber))];
        const blockCache = new Map<number, number>();
        await Promise.all(
            blockNumbers.map(async (bn) => {
                const block = await provider.getBlock(bn);
                if (block) blockCache.set(bn, block.timestamp);
            })
        );

        function getBlockTimestamp(blockNum: number): number {
            return blockCache.get(blockNum) ?? 0;
        }
        function txHash(log: { transactionHash?: string }): string | undefined {
            return (log as any).transactionHash ?? undefined;
        }

        for (const log of createdLogs) {
            const args = (log as any).args;
            const roundId = args?.roundId != null ? Number(args.roundId) : undefined;
            const timestamp = getBlockTimestamp(log.blockNumber);
            events.push({
                id: `contract-created-${log.blockNumber}-${log.index}-${roundId}`,
                eventType: "COMMIT_PHASE_STARTED",
                message: roundId != null ? `Round #${roundId} — Commit phase started` : "Commit phase started",
                roundId,
                timestamp: new Date(timestamp * 1000).toISOString(),
                detail: "Commit phase",
                transactionHash: txHash(log),
            });
        }
        for (const log of committedLogs) {
            const args = (log as any).args;
            const roundId = args?.roundId != null ? Number(args.roundId) : undefined;
            const agentId = args?.agentId != null ? String(args.agentId) : "";
            const agentName = agentDisplayName(agentId);
            const timestamp = getBlockTimestamp(log.blockNumber);
            events.push({
                id: `contract-commit-${log.blockNumber}-${log.index}-${roundId}-${agentId}`,
                eventType: "PREDICTION_COMMITTED",
                message: `${agentName} committed prediction to Hedera`,
                agentName,
                roundId,
                timestamp: new Date(timestamp * 1000).toISOString(),
                detail: "Commit",
                transactionHash: txHash(log),
            });
        }
        const seenRevealRound = new Set<number>();
        for (const log of revealedLogs) {
            const args = (log as any).args;
            const roundId = args?.roundId != null ? Number(args.roundId) : undefined;
            const agentId = args?.agentId != null ? String(args.agentId) : "";
            const direction = args?.direction === 0 ? "UP" : args?.direction === 1 ? "DOWN" : undefined;
            const confidence = args?.confidence != null ? Number(args.confidence) : undefined;
            const agentName = agentDisplayName(agentId);
            const timestamp = getBlockTimestamp(log.blockNumber);
            if (roundId != null && !seenRevealRound.has(roundId)) {
                seenRevealRound.add(roundId);
                events.push({
                    id: `contract-reveal-phase-${roundId}-${log.blockNumber}`,
                    eventType: "REVEAL_PHASE_STARTED",
                    message: "Reveal phase started",
                    roundId,
                    timestamp: new Date(timestamp * 1000).toISOString(),
                    detail: "Reveal",
                    transactionHash: txHash(log),
                });
            }
            events.push({
                id: `contract-reveal-${log.blockNumber}-${log.index}-${roundId}-${agentId}`,
                eventType: "PREDICTION_REVEALED",
                message: direction != null && confidence != null
                    ? `${agentName} revealed prediction: ${direction} (${confidence}%)`
                    : `${agentName} revealed prediction`,
                agentName,
                roundId,
                timestamp: new Date(timestamp * 1000).toISOString(),
                detail: direction != null && confidence != null ? `${direction} (${confidence}%)` : "Reveal",
                transactionHash: txHash(log),
            });
        }
        for (const log of resolvedLogs) {
            const args = (log as any).args;
            const roundId = args?.roundId != null ? Number(args.roundId) : undefined;
            const outcome = args?.outcome === 0 ? "UP" : args?.outcome === 1 ? "DOWN" : undefined;
            const timestamp = getBlockTimestamp(log.blockNumber);
            events.push({
                id: `contract-resolved-${log.blockNumber}-${log.index}-${roundId}`,
                eventType: "ROUND_RESOLVED",
                message: roundId != null ? `Round #${roundId} resolved — Outcome: ${outcome ?? "?"}` : `Round resolved: ${outcome ?? "?"}`,
                roundId,
                timestamp: new Date(timestamp * 1000).toISOString(),
                detail: outcome ?? "Resolved",
                transactionHash: txHash(log),
            });
        }
        for (const log of claimedLogs) {
            const args = (log as any).args;
            const roundId = args?.roundId != null ? Number(args.roundId) : undefined;
            const agentId = args?.agentId != null ? String(args.agentId) : "";
            const delta = args?.credScoreDelta != null ? Number(args.credScoreDelta) : (args?.delta != null ? Number(args.delta) : 0);
            const agentName = agentDisplayName(agentId);
            const timestamp = getBlockTimestamp(log.blockNumber);
            const sign = delta >= 0 ? "+" : "";
            events.push({
                id: `contract-claim-${log.blockNumber}-${log.index}-${roundId}-${agentId}`,
                eventType: "LEADERBOARD_CHANGED",
                message: `${agentName} ${sign}${delta} CredScore`,
                agentName,
                roundId,
                timestamp: new Date(timestamp * 1000).toISOString(),
                detail: `${sign}${delta}`,
                transactionHash: txHash(log),
            });
        }
    } catch (e) {
        console.warn("Timeline: fetch contract events failed", e);
    }

    return events;
}

async function fetchTimelineEvents(limit: number): Promise<TimelineEvent[]> {
    const predictionsTopicId = TOPIC_IDS.predictions || TOPIC_IDS.legacyRounds;
    const resultsTopicId = TOPIC_IDS.results || TOPIC_IDS.legacyRounds;
    const topics = [
        ...(predictionsTopicId ? [{ topicId: predictionsTopicId, kind: "predictions" as const }] : []),
        ...(resultsTopicId && resultsTopicId !== predictionsTopicId ? [{ topicId: resultsTopicId, kind: "results" as const }] : []),
    ];
    if (topics.length === 0) return [];

    const perTopic = Math.max(30, Math.ceil(limit / topics.length));
    const allMessages: Array<{
        topicId: string;
        kind: "predictions" | "results";
        consensus_timestamp: string;
        message: string;
        sequence_number: number;
    }> = [];

    await Promise.all(
        topics.map(async ({ topicId, kind }) => {
            try {
                const messages = await fetchTopicMessages(topicId, perTopic, "desc");
                for (const m of messages) {
                    allMessages.push({
                        topicId: m.topic_id ?? topicId,
                        kind,
                        consensus_timestamp: m.consensus_timestamp,
                        message: m.message,
                        sequence_number: m.sequence_number ?? 0,
                    });
                }
            } catch (e) {
                console.warn("Timeline: fetch topic failed", topicId, e);
            }
        })
    );

    const events: TimelineEvent[] = [];

    for (const msg of allMessages) {
        const parsed = decodeBase64Json<Record<string, unknown>>(msg.message);
        if (!parsed || typeof parsed !== "object") continue;

        const ts = msg.consensus_timestamp;
        const iso = consensusTimestampToIso(ts);
        const idBase = `${msg.topicId}-${msg.sequence_number}`;

        if (parsed.type === "THINKING") {
            const agentId = String(parsed.agentId ?? "").trim();
            const agentName = agentDisplayName(agentId);
            const thought = typeof parsed.thought === "string" ? parsed.thought : "";
            events.push({
                id: `${idBase}-thinking`,
                eventType: "AGENT_ANALYSIS_STARTED",
                message: thought ? thought : `${agentName} is analyzing market data`,
                agentName,
                roundId: parsed.roundId != null ? Number(parsed.roundId) : (parsed.round_id != null ? Number(parsed.round_id) : undefined),
                timestamp: iso,
                topicId: msg.topicId,
                sequenceNumber: msg.sequence_number,
                detail: "Thinking",
            });
        }

        if (parsed.type === "REASONING") {
            const agentId = String(parsed.agentId ?? "").trim();
            const agentName = agentDisplayName(agentId);
            const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
            const snippet = reasoning.length > 140 ? reasoning.slice(0, 137) + "…" : reasoning;
            events.push({
                id: `${idBase}-reasoning`,
                eventType: "AGENT_REASONING_PUBLISHED",
                message: snippet ? `${agentName}: ${snippet}` : `${agentName} published reasoning`,
                agentName,
                roundId: parsed.roundId != null ? Number(parsed.roundId) : (parsed.round_id != null ? Number(parsed.round_id) : undefined),
                timestamp: iso,
                topicId: msg.topicId,
                sequenceNumber: msg.sequence_number,
                detail: typeof parsed.confidence === "number" ? `${parsed.confidence}%` : undefined,
            });
        }

        if (parsed.type === "RESULT") {
            const roundId = typeof parsed.roundId === "number" ? parsed.roundId : undefined;
            const outcome = parsed.outcome === "UP" ? "UP" : parsed.outcome === "DOWN" ? "DOWN" : undefined;
            events.push({
                id: `${idBase}-resolved`,
                eventType: "ROUND_RESOLVED",
                message: outcome ? `Round #${roundId ?? "?"} resolved — Outcome: ${outcome}` : `Round #${roundId ?? "?"} resolved`,
                roundId,
                timestamp: iso,
                topicId: msg.topicId,
                sequenceNumber: msg.sequence_number,
                detail: outcome,
            });

            const scores = Array.isArray(parsed.scores) ? parsed.scores : [];
            scores.forEach((s: any, i: number) => {
                const agentName = agentDisplayName(s?.agentId ?? "");
                const delta = typeof s?.credScoreDelta === "number" ? s.credScoreDelta : 0;
                const sign = delta >= 0 ? "+" : "";
                events.push({
                    id: `${idBase}-score-${i}`,
                    eventType: "LEADERBOARD_CHANGED",
                    message: `${agentName} ${sign}${delta} CredScore`,
                    agentName,
                    roundId,
                    timestamp: iso,
                    topicId: msg.topicId,
                    sequenceNumber: msg.sequence_number,
                    detail: `${sign}${delta}`,
                });
            });
        }
    }

    const contractEvents = await fetchContractTimelineEvents(limit);
    const combined = [...events, ...contractEvents];
    combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return combined.slice(0, limit);
}

export function useIntelligenceTimeline(limit: number = 50, filters?: TimelineFilters) {
    return useQuery({
        queryKey: ["intelligenceTimeline", limit, filters?.roundId, filters?.agentName],
        queryFn: () => fetchTimelineEvents(limit),
        refetchInterval: 2000,
        select: (data) => {
            let out = data;
            if (filters?.roundId != null) {
                const roundMatch = data.filter((e) => e.roundId === filters.roundId);
                const reasoningWithoutRound = data.filter(
                    (e) => e.eventType === "AGENT_REASONING_PUBLISHED" && e.roundId == null
                );
                out = [...roundMatch, ...reasoningWithoutRound.slice(0, 20)];
                out.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                out = out.slice(0, limit);
            }
            if (filters?.agentName) {
                const name = filters.agentName.toLowerCase();
                out = out.filter((e) => e.agentName?.toLowerCase() === name);
            }
            return out;
        },
    });
}
