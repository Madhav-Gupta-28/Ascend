import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy to the Render orchestrator's /status endpoint.
 * The frontend polls this during active rounds, which keeps
 * the Render free-tier service alive (prevents 15-min idle shutdown).
 */
export async function GET() {
    const renderUrl = process.env.ORCHESTRATOR_URL;
    if (!renderUrl) {
        return NextResponse.json(
            { status: "not_configured", message: "ORCHESTRATOR_URL not set" },
            { status: 200 },
        );
    }

    try {
        const res = await fetch(`${renderUrl}/status`, {
            signal: AbortSignal.timeout(8_000),
            headers: { "Cache-Control": "no-cache" },
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json(
            { status: "unreachable", error: err?.message || "Fetch failed" },
            { status: 200 },
        );
    }
}
