import { NextResponse } from "next/server";
import {
    fetchAdminAgentStatuses,
    getDefaultAdminRoundConfig,
} from "@/lib/server/admin-rounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const statuses = await fetchAdminAgentStatuses();
        return NextResponse.json({
            success: true,
            selectionPolicy: "FIRST_4_ELIGIBLE_BY_ID",
            operatorOwnerAddress: statuses.operatorOwnerAddress,
            defaults: getDefaultAdminRoundConfig(),
            allAgents: statuses.allAgents,
            eligibleAgents: statuses.eligibleAgents,
            selectedAgents: statuses.selectedAgents,
            totalEligible: statuses.eligibleAgents.length,
            selectedCount: statuses.selectedAgents.length,
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
