import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { AGENT_REGISTRY_ABI, CONTRACT_ADDRESSES, PREDICTION_MARKET_ABI, TOPIC_IDS } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SignalDirection = "UP" | "DOWN" | "UNKNOWN";

type AgentSignal = {
    roundId?: number;
    direction: SignalDirection;
    confidence: number | null;
    timestamp: string;
    reasoning: string;
    summary: string;
    txHash?: string;
    hashscanUrl?: string;
};

function getRpcUrl(): string {
    return (
        process.env.HEDERA_JSON_RPC ||
        process.env.NEXT_PUBLIC_HEDERA_JSON_RPC ||
        "https://testnet.hashio.io/api"
    );
}

function getMirrorBase(): string {
    const network =
        process.env.HEDERA_NETWORK || process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet";
    const configured =
        process.env.HEDERA_MIRROR_NODE || process.env.NEXT_PUBLIC_HEDERA_MIRROR_NODE;
    const base = (configured || `https://${network}.mirrornode.hedera.com`).replace(/\/+$/, "");
    return base.endsWith("/api/v1") ? base.slice(0, -7) : base;
}

function hashscanTxUrl(txHash: string): string {
    const network = process.env.NEXT_PUBLIC_HEDERA_NETWORK || process.env.HEDERA_NETWORK || "testnet";
    return `https://hashscan.io/${network}/transaction/${txHash}`;
}

function toIsoFromConsensus(consensusTs: string): string {
    const [secondsRaw, nanosRaw = "0"] = consensusTs.split(".");
    const seconds = Number(secondsRaw);
    const nanos = Number(nanosRaw.padEnd(9, "0").slice(0, 9));
    const ms = seconds * 1000 + Math.floor(nanos / 1_000_000);
    return new Date(ms).toISOString();
}

function decodeBase64Json<T>(value: string): T | null {
    try {
        const decoded = Buffer.from(value, "base64").toString("utf8");
        return JSON.parse(decoded) as T;
    } catch {
        return null;
    }
}

function summarizeReasoning(reasoning: string): string {
    const clean = reasoning.trim().replace(/\s+/g, " ");
    if (!clean) return "No reasoning provided";
    return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
}

function directionFromNumber(value: number): SignalDirection {
    if (value === 0) return "UP";
    if (value === 1) return "DOWN";
    return "UNKNOWN";
}

function messageMatchesAgent(
    parsedAgentId: unknown,
    parsedAgentName: unknown,
    agentId: number,
    agentName: string | null,
): boolean {
    const idRaw = String(parsedAgentId ?? "").trim().toLowerCase();
    const nameRaw = String(parsedAgentName ?? "").trim().toLowerCase();
    if (idRaw === String(agentId)) return true;
    if (agentName && idRaw === agentName.toLowerCase()) return true;
    if (agentName && nameRaw === agentName.toLowerCase()) return true;
    return false;
}

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params;
    const agentId = Number.parseInt(id, 10);
    if (!Number.isFinite(agentId) || agentId <= 0) {
        return NextResponse.json({ success: false, error: "Invalid agent id" }, { status: 400 });
    }

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "20");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 20;

    if (!CONTRACT_ADDRESSES.predictionMarket || !CONTRACT_ADDRESSES.agentRegistry) {
        return NextResponse.json(
            { success: false, error: "Contract addresses are not configured" },
            { status: 500 },
        );
    }

    const provider = new ethers.JsonRpcProvider(getRpcUrl());
    const market = new ethers.Contract(
        CONTRACT_ADDRESSES.predictionMarket,
        PREDICTION_MARKET_ABI,
        provider,
    );
    const registry = new ethers.Contract(
        CONTRACT_ADDRESSES.agentRegistry,
        AGENT_REGISTRY_ABI,
        provider,
    );

    let agentName: string | null = null;
    try {
        const agent = await registry.getAgent(agentId);
        agentName = typeof agent?.name === "string" ? agent.name : null;
    } catch {
        agentName = null;
    }

    const reasonByRound = new Map<number, { reasoning: string; summary: string; confidence: number | null; timestamp: string }>();
    const predictionsTopicId = TOPIC_IDS.predictions || TOPIC_IDS.legacyRounds;

    if (predictionsTopicId) {
        try {
            const mirrorBase = getMirrorBase();
            const url = `${mirrorBase}/api/v1/topics/${encodeURIComponent(predictionsTopicId)}/messages?limit=180&order=desc`;
            const res = await fetch(url, {
                cache: "no-store",
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(12_000),
            });

            if (res.ok) {
                const payload = await res.json();
                const messages = Array.isArray(payload?.messages) ? payload.messages : [];
                for (const msg of messages) {
                    const parsed = decodeBase64Json<Record<string, unknown>>(String(msg.message || ""));
                    if (!parsed) continue;
                    if (String(parsed.type || "").toUpperCase() !== "REASONING") continue;

                    const matches = messageMatchesAgent(
                        parsed.agentId,
                        parsed.agentName,
                        agentId,
                        agentName,
                    );
                    if (!matches) continue;

                    const roundIdRaw =
                        typeof parsed.roundId === "number"
                            ? parsed.roundId
                            : typeof parsed.round_id === "number"
                                ? parsed.round_id
                                : Number.parseInt(String(parsed.roundId ?? parsed.round_id ?? ""), 10);
                    if (!Number.isFinite(roundIdRaw) || roundIdRaw <= 0) continue;
                    const roundId = Number(roundIdRaw);

                    const reasoning =
                        typeof parsed.reasoning === "string" ? parsed.reasoning : "";
                    const confidence =
                        typeof parsed.confidence === "number" ? parsed.confidence : null;
                    const timestamp = toIsoFromConsensus(String(msg.consensus_timestamp));

                    if (!reasonByRound.has(roundId)) {
                        reasonByRound.set(roundId, {
                            reasoning,
                            summary: summarizeReasoning(reasoning),
                            confidence,
                            timestamp,
                        });
                    }
                }
            }
        } catch {
            // Keep response functional from on-chain logs even if HCS query fails.
        }
    }

    const signals: AgentSignal[] = [];

    try {
        const blockNumber = await provider.getBlockNumber();
        const fromBlock = Math.max(0, blockNumber - 3000);
        const logs = await market.queryFilter(
            market.filters.PredictionRevealed(null, BigInt(agentId)),
            fromBlock,
            "latest",
        );

        for (const log of logs) {
            const args = (log as any).args;
            const roundId = args?.roundId != null ? Number(args.roundId) : undefined;
            const direction = directionFromNumber(args?.direction != null ? Number(args.direction) : -1);
            const confidence = args?.confidence != null ? Number(args.confidence) : null;
            const block = await provider.getBlock(log.blockNumber);
            const timestamp = new Date((block?.timestamp || 0) * 1000).toISOString();
            const reasoning = roundId != null ? reasonByRound.get(roundId)?.reasoning ?? "" : "";
            const summary = roundId != null ? reasonByRound.get(roundId)?.summary ?? "No reasoning found on HCS for this reveal" : "No reasoning found on HCS for this reveal";

            signals.push({
                roundId,
                direction,
                confidence,
                timestamp,
                reasoning,
                summary,
                txHash: log.transactionHash,
                hashscanUrl: hashscanTxUrl(log.transactionHash),
            });
        }
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error?.message || "Failed to read on-chain reveals" },
            { status: 500 },
        );
    }

    // Include latest reasoning messages even if reveal has not happened yet.
    for (const [roundId, reasoning] of reasonByRound.entries()) {
        const alreadyIncluded = signals.some((signal) => signal.roundId === roundId);
        if (alreadyIncluded) continue;
        signals.push({
            roundId,
            direction: "UNKNOWN",
            confidence: reasoning.confidence,
            timestamp: reasoning.timestamp,
            reasoning: reasoning.reasoning,
            summary: reasoning.summary,
        });
    }

    signals.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({
        success: true,
        agentId,
        agentName,
        signals: signals.slice(0, limit),
    });
}
