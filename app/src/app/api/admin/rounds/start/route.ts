import { NextRequest, NextResponse } from "next/server";
import { hashscanTransactionUrl } from "@/lib/explorer";
import {
    ADMIN_SELECTION_POLICY,
    createAdminRound,
    fetchAdminAgentStatuses,
    parseAdminRoundConfig,
    saveAdminRoundPlan,
    signalLocalOrchestratorWake,
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
                        "No eligible agents found. Ensure agents are active and operator-managed.",
                },
                { status: 409 },
            );
        }

        const created = await createAdminRound(config);

        saveAdminRoundPlan({
            roundId: created.roundId,
            selectedAgentIds: selectedAgents.map((a) => a.id),
            selectedAgentNames: selectedAgents.map((a) => a.name),
            selectionPolicy: ADMIN_SELECTION_POLICY,
            createdAt: new Date().toISOString(),
        });

        const localWake = signalLocalOrchestratorWake(created.roundId);

        // Wake the Render orchestrator so it picks up the new round.
        // Render free tier cold-starts take 30-60s, so we retry with increasing timeouts.
        let orchestratorWake: { status: string; error?: string } = { status: "skipped" };
        const renderUrl = process.env.ORCHESTRATOR_URL;
        if (renderUrl) {
            const wakeHeaders: Record<string, string> = {
                "Content-Type": "application/json",
                ...(process.env.ORCHESTRATOR_WAKE_SECRET
                    ? { Authorization: `Bearer ${process.env.ORCHESTRATOR_WAKE_SECRET}` }
                    : {}),
            };

            // Try up to 3 times: 15s, 30s, 30s — covers Render cold-start
            const timeouts = [15_000, 30_000, 30_000];
            for (let attempt = 0; attempt < timeouts.length; attempt++) {
                try {
                    const wakeRes = await fetch(`${renderUrl}/wake`, {
                        method: "POST",
                        headers: wakeHeaders,
                        signal: AbortSignal.timeout(timeouts[attempt]),
                    });
                    const wakeBody = await wakeRes.json().catch(() => ({}));
                    orchestratorWake = { status: wakeRes.ok ? "woken" : `http_${wakeRes.status}`, ...wakeBody };
                    break; // success
                } catch (err: any) {
                    orchestratorWake = { status: "unreachable", error: err?.message };
                    if (attempt < timeouts.length - 1) {
                        console.log(`[admin/start] Wake attempt ${attempt + 1} failed, retrying...`);
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            roundId: created.roundId,
            txHash: created.txHash,
            txHashscanUrl: hashscanTransactionUrl(created.txHash),
            startPriceUsd: created.startPriceUsd,
            config,
            selectionPolicy: ADMIN_SELECTION_POLICY,
            selectedAgents,
            cancelledStaleRoundIds: created.cancelledStaleRoundIds,
            cancelledStaleRoundTxHashes: created.cancelledStaleRoundTxHashes,
            localWake,
            orchestratorWake,
        });
    } catch (error: any) {
        const message = error?.message || "Failed to start admin round";
        const status =
            typeof message === "string" &&
            message.toLowerCase().includes("active round")
                ? 409
                : 500;
        return NextResponse.json(
            {
                success: false,
                error: message,
            },
            { status },
        );
    }
}
