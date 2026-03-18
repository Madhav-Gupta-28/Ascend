import { NextRequest, NextResponse } from "next/server";
import {
    cleanupStaleAdminRounds,
    inspectAdminRoundHealth,
} from "@/lib/server/admin-rounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertAdminAccess(req: NextRequest): void {
    const requiredKey = (process.env.ASCEND_ADMIN_API_KEY || "").trim();
    if (!requiredKey) return;
    const provided = (req.headers.get("x-admin-key") || "").trim();
    if (provided !== requiredKey) {
        throw new Error("Unauthorized: invalid admin key");
    }
}

function txHashscanUrl(txHash: string): string {
    return `https://hashscan.io/${process.env.HEDERA_NETWORK || "testnet"}/transaction/${txHash}`;
}

export async function GET() {
    try {
        const health = await inspectAdminRoundHealth();
        return NextResponse.json({
            success: true,
            ...health,
            fetchedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "Failed to inspect round health",
            },
            { status: 500 },
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        assertAdminAccess(req);
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error?.message || "Unauthorized" },
            { status: 401 },
        );
    }

    try {
        const cleaned = await cleanupStaleAdminRounds();
        return NextResponse.json({
            success: true,
            ...cleaned,
            cancelledStaleRoundTxUrls: cleaned.cancelledTxHashes.map((txHash) => txHashscanUrl(txHash)),
            cleanedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "Failed to cleanup stale rounds",
            },
            { status: 500 },
        );
    }
}

