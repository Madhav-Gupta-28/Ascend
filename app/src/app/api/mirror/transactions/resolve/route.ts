import { NextRequest, NextResponse } from "next/server";
import {
    getHederaNetwork,
    hashscanTransactionUrl,
    isTransactionHash,
    isTransactionId,
    normalizeTransactionId,
} from "@/lib/explorer";

function normalizeMirrorNodeBase(baseUrl: string): string {
    const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!trimmed) return "https://testnet.mirrornode.hedera.com";
    return trimmed.endsWith("/api/v1") ? trimmed.slice(0, -7) : trimmed;
}

function getMirrorNodeBase(): string {
    const network = process.env.HEDERA_NETWORK || process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet";
    return normalizeMirrorNodeBase(
        process.env.HEDERA_MIRROR_NODE ||
            process.env.NEXT_PUBLIC_HEDERA_MIRROR_NODE ||
            `https://${network}.mirrornode.hedera.com`,
    );
}

async function resolveTxIdFromHash(
    txHash: string,
    mirrorBase: string,
): Promise<string | null> {
    const contractResultRes = await fetch(
        `${mirrorBase}/api/v1/contracts/results/${encodeURIComponent(txHash)}`,
        {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(12_000),
            cache: "no-store",
        },
    );
    if (!contractResultRes.ok) return null;
    const contractResult = await contractResultRes.json();
    const consensusTimestamp = String(contractResult?.timestamp || "").trim();
    if (!consensusTimestamp) return null;

    const txByTimestampRes = await fetch(
        `${mirrorBase}/api/v1/transactions?timestamp=${encodeURIComponent(consensusTimestamp)}`,
        {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(12_000),
            cache: "no-store",
        },
    );
    if (!txByTimestampRes.ok) return null;
    const txPayload = await txByTimestampRes.json();
    const txs = Array.isArray(txPayload?.transactions) ? txPayload.transactions : [];
    if (txs.length === 0) return null;

    const candidate =
        txs.find((tx: any) => tx?.name === "ETHEREUMTRANSACTION" && typeof tx?.transaction_id === "string") ||
        txs.find((tx: any) => typeof tx?.transaction_id === "string") ||
        null;

    const txIdRaw = typeof candidate?.transaction_id === "string" ? candidate.transaction_id.trim() : "";
    if (!txIdRaw) return null;
    return normalizeTransactionId(txIdRaw);
}

export async function GET(request: NextRequest) {
    const input = String(request.nextUrl.searchParams.get("id") || "").trim();
    if (!input) {
        return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    const network = getHederaNetwork();
    const mirrorBase = getMirrorNodeBase();

    try {
        if (isTransactionId(input)) {
            const resolvedTxId = normalizeTransactionId(input);
            return NextResponse.json({
                success: true,
                input,
                resolvedTxId,
                hashscanUrl: hashscanTransactionUrl(resolvedTxId, network),
                source: "direct",
            });
        }

        if (!isTransactionHash(input)) {
            return NextResponse.json(
                { success: false, error: "id must be a Hedera transaction id or EVM tx hash" },
                { status: 400 },
            );
        }

        const resolvedTxId = await resolveTxIdFromHash(input, mirrorBase);
        if (!resolvedTxId) {
            return NextResponse.json({
                success: false,
                input,
                resolvedTxId: null,
                hashscanUrl: hashscanTransactionUrl(input, network),
                source: "fallback-hash",
            });
        }

        return NextResponse.json({
            success: true,
            input,
            resolvedTxId,
            hashscanUrl: hashscanTransactionUrl(resolvedTxId, network),
            source: "mirror",
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, input, error: error?.message || "Failed to resolve transaction" },
            { status: 500 },
        );
    }
}
