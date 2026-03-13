/**
 * Ascend — HOL Agent Discovery API
 *
 * Queries the HOL Registry Broker to find Ascend agents
 * and returns their profiles, capabilities, and HCS-10 topic IDs.
 *
 * GET /api/hol/agents
 */

import { NextResponse } from "next/server";

const HOL_REGISTRY_BASE = "https://hol.org/registry/api/v1";
const CACHE_TTL_MS = 60_000; // 60 seconds

let cachedResponse: { data: unknown; fetchedAt: number } | null = null;

export async function GET() {
    // Return cached response if fresh
    if (cachedResponse && Date.now() - cachedResponse.fetchedAt < CACHE_TTL_MS) {
        return NextResponse.json(cachedResponse.data);
    }

    try {
        const searchUrl = `${HOL_REGISTRY_BASE}/search?q=ascend&limit=10`;
        const res = await fetch(searchUrl, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
            console.error(`[HOL API] Search failed: ${res.status} ${res.statusText}`);
            return NextResponse.json(
                { agents: [], error: "HOL Registry search failed" },
                { status: 502 },
            );
        }

        const data = await res.json();

        // Extract agent entries - the search API returns different shapes
        const agents = Array.isArray(data)
            ? data
            : Array.isArray(data?.results)
              ? data.results
              : Array.isArray(data?.agents)
                ? data.agents
                : [];

        const ascendAgents = agents
            .filter((a: any) => {
                const name = (a.name ?? a.display_name ?? "").toLowerCase();
                const desc = (a.description ?? "").toLowerCase();
                return name.includes("ascend") || desc.includes("ascend intelligence");
            })
            .map((a: any) => ({
                uaid: a.uaid ?? a.id ?? null,
                name: a.name ?? a.display_name ?? "Unknown",
                description: a.description ?? "",
                capabilities: a.capabilities ?? [],
                accountId: a.account_id ?? a.accountId ?? null,
                inboundTopicId: a.inbound_topic_id ?? a.inboundTopicId ?? null,
                profileTopicId: a.profile_topic_id ?? a.profileTopicId ?? null,
                trustScore: a.trust_score ?? a.trustScore ?? null,
                verified: a.verified ?? false,
            }));

        const responseData = {
            agents: ascendAgents,
            total: ascendAgents.length,
            registryUrl: "https://hol.org/registry",
            fetchedAt: new Date().toISOString(),
        };

        cachedResponse = { data: responseData, fetchedAt: Date.now() };
        return NextResponse.json(responseData);
    } catch (err: any) {
        console.error(`[HOL API] Error: ${err.message}`);
        return NextResponse.json(
            { agents: [], error: err.message },
            { status: 500 },
        );
    }
}
