import { NextRequest, NextResponse } from "next/server";
import {
    createAdminRound,
    fetchAdminAgentStatuses,
    parseAdminRoundConfig,
    saveAdminRoundPlan,
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

export async function POST(req: NextRequest) {
    try {
        assertAdminAccess(req);
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error?.message || "Unauthorized" },
            { status: 401 },
        );
    }

    let body: unknown = {};
    try {
        body = await req.json();
    } catch {
        body = {};
    }

    try {
        const config = parseAdminRoundConfig(body);
        const statuses = await fetchAdminAgentStatuses();
        const selectedAgents = statuses.selectedAgents;

        if (selectedAgents.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "No eligible agents found. Ensure agents are active, HOL-registered, and operator-managed.",
                },
                { status: 409 },
            );
        }

        const created = await createAdminRound(config);

        saveAdminRoundPlan({
            roundId: created.roundId,
            selectedAgentIds: selectedAgents.map((a) => a.id),
            selectedAgentNames: selectedAgents.map((a) => a.name),
            selectionPolicy: "FIRST_4_ELIGIBLE_BY_ID",
            createdAt: new Date().toISOString(),
        });

        return NextResponse.json({
            success: true,
            roundId: created.roundId,
            txHash: created.txHash,
            txHashscanUrl: `https://hashscan.io/${process.env.HEDERA_NETWORK || "testnet"}/transaction/${created.txHash}`,
            startPriceUsd: created.startPriceUsd,
            config,
            selectionPolicy: "FIRST_4_ELIGIBLE_BY_ID",
            selectedAgents,
            note:
                "Round created. Run orchestrator in admin-control mode to execute commit/reveal/resolve for the selected roster.",
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "Failed to start admin round",
            },
            { status: 500 },
        );
    }
}
