import { NextResponse } from "next/server";
import {
    ADMIN_SELECTION_POLICY,
    fetchAdminAgentStatuses,
    getDefaultAdminRoundConfig,
    inspectAdminRoundHealth,
} from "@/lib/server/admin-rounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const [statuses, health] = await Promise.all([
            fetchAdminAgentStatuses(),
            inspectAdminRoundHealth(),
        ]);
        return NextResponse.json({
            success: true,
            selectionPolicy: ADMIN_SELECTION_POLICY,
            operatorOwnerAddress: statuses.operatorOwnerAddress,
            defaults: getDefaultAdminRoundConfig(),
            allAgents: statuses.allAgents,
            eligibleAgents: statuses.eligibleAgents,
            selectedAgents: statuses.selectedAgents,
            totalEligible: statuses.eligibleAgents.length,
            selectedCount: statuses.selectedAgents.length,
            activeRoundIds: health.activeRoundIds,
            staleActiveRoundIds: health.staleActiveRoundIds,
            latestRoundId: health.latestRoundId,
            fetchedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "Failed to fetch eligible agents",
            },
            { status: 500 },
        );
    }
}
