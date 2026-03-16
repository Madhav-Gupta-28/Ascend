import { NextRequest, NextResponse } from "next/server";

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

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ topicId: string }> },
) {
    const { topicId } = await context.params;
    const searchParams = request.nextUrl.searchParams;
    const limitParam = Number(searchParams.get("limit") || "100");
    const order = searchParams.get("order") === "asc" ? "asc" : "desc";
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 100;

    if (!/^\d+\.\d+\.\d+$/.test(topicId)) {
        return NextResponse.json({ messages: [], error: "Invalid topic id" });
    }

    const mirrorBase = getMirrorNodeBase();
    const url = `${mirrorBase}/api/v1/topics/${encodeURIComponent(topicId)}/messages?limit=${limit}&order=${order}`;

    try {
        const response = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
            cache: "no-store",
        });

        if (!response.ok) {
            return NextResponse.json({
                messages: [],
                error: `Mirror node error ${response.status}`,
                source: mirrorBase,
            });
        }

        const data = await response.json();
        return NextResponse.json({
            messages: Array.isArray(data?.messages) ? data.messages : [],
            links: data?.links ?? null,
            source: mirrorBase,
        });
    } catch (error: any) {
        return NextResponse.json({
            messages: [],
            error: error?.message || "Mirror request failed",
            source: mirrorBase,
        });
    }
}
