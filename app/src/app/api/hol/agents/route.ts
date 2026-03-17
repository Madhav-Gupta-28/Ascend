/**
 * Ascend — HOL Agent Discovery API
 *
 * Queries the HOL Registry Broker to find Ascend agents
 * and returns their profiles, capabilities, and HCS-10 topic IDs.
 *
 * GET /api/hol/agents
 */

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const HOL_REGISTRY_BASE = "https://hol.org/registry/api/v1";
const HOL_GUARDED_REGISTRY_BASE =
    process.env.HOL_GUARDED_REGISTRY_BASE_URL ?? "https://moonscape.tech";
const HEDERA_NETWORK = process.env.HEDERA_NETWORK ?? "testnet";
const CACHE_TTL_MS = 10_000; // 10 seconds

let cachedResponse: { data: unknown; fetchedAt: number } | null = null;

type HolState = {
    name: string;
    accountId: string | null;
    inboundTopicId: string | null;
    profileTopicId: string | null;
};

type HolAgentResponse = {
    uaid: string | null;
    name: string;
    description: string;
    capabilities: unknown[];
    accountId: string | null;
    inboundTopicId: string | null;
    profileTopicId: string | null;
    trustScore: number | null;
    verified: boolean;
    profileUrl: string;
};

function getHolProfileUrl(uaid?: string | null): string {
    if (uaid && uaid.trim().length > 0) {
        return `https://hol.org/registry/agent/${encodeURIComponent(uaid.trim())}`;
    }
    return "https://hol.org/registry";
}

function normalizeAgentName(rawName: string): string {
    const trimmed = rawName.trim();
    if (!trimmed) return "Unknown";
    return trimmed;
}

function isAscendAgent(candidate: any): boolean {
    const name = String(candidate?.name ?? candidate?.display_name ?? "").toLowerCase();
    const description = String(candidate?.description ?? candidate?.bio ?? "").toLowerCase();
    const creator = String(candidate?.profile?.aiAgent?.creator ?? candidate?.creator ?? "").toLowerCase();
    const platform = String(
        candidate?.profile?.properties?.platform ??
            candidate?.metadata?.platform ??
            candidate?.metadata?.onchainMetadata?.platform ??
            "",
    ).toLowerCase();

    if (name.startsWith("ascend:")) return true;
    if (creator.includes("ascend intelligence market")) return true;
    if (platform.includes("ascend intelligence market")) return true;
    if (description.includes("ascend intelligence market")) return true;
    return false;
}

function loadLocalHolStates(): HolState[] {
    const candidateDirs = [
        process.env.HOL_STATE_DIR,
        path.resolve(process.cwd(), "../agents/.cache"),
        path.resolve(process.cwd(), ".cache"),
    ].filter(Boolean) as string[];

    for (const dir of candidateDirs) {
        try {
            if (!fs.existsSync(dir)) continue;
            const files = fs
                .readdirSync(dir)
                .filter((f) => f.startsWith("hol_") && f.endsWith("_state.json"));
            if (files.length === 0) continue;

            return files.map((file) => {
                const raw = fs.readFileSync(path.join(dir, file), "utf8");
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                const name = file
                    .replace(/^hol_/, "")
                    .replace(/_state\.json$/, "")
                    .replace(/^\w/, (c) => c.toUpperCase());
                return {
                    name,
                    accountId: typeof parsed.accountId === "string" ? parsed.accountId : null,
                    inboundTopicId:
                        typeof parsed.inboundTopicId === "string" ? parsed.inboundTopicId : null,
                    profileTopicId:
                        typeof parsed.profileTopicId === "string" ? parsed.profileTopicId : null,
                };
            });
        } catch {
            // Ignore malformed local cache and move to next candidate path.
        }
    }

    return [];
}

async function fetchGuardedRegistryAgents(states: HolState[]) {
    const results = await Promise.all(
        states.map(async (state) => {
            if (!state.accountId) return null;
            try {
                const url = `${HOL_GUARDED_REGISTRY_BASE}/api/registrations?accountId=${state.accountId}&network=${HEDERA_NETWORK}`;
                const res = await fetch(url, {
                    headers: { Accept: "application/json" },
                    signal: AbortSignal.timeout(8_000),
                });
                if (!res.ok) return null;
                const payload = await res.json();
                const regs = Array.isArray(payload?.registrations) ? payload.registrations : [];
                const completed = regs.find((r: any) => r?.status === "completed");
                const reg = completed ?? regs[0];
                if (!reg) return null;

                const profile = reg.metadata ?? {};
                return {
                    uaid: profile.uaid ?? reg.id ?? null,
                    name: profile.display_name ?? `Ascend: ${state.name}`,
                    description: profile.bio ?? "",
                    capabilities: profile?.aiAgent?.capabilities ?? [],
                    accountId: reg.accountId ?? state.accountId,
                    inboundTopicId: reg.inboundTopicId ?? state.inboundTopicId,
                    profileTopicId: state.profileTopicId,
                    trustScore: null,
                    verified: reg.status === "completed",
                    profileUrl: getHolProfileUrl(profile.uaid ?? reg.uaid ?? null),
                };
            } catch {
                return null;
            }
        }),
    );

    return results.filter(Boolean);
}

export async function GET() {
    // Return cached response if fresh
    if (cachedResponse && Date.now() - cachedResponse.fetchedAt < CACHE_TTL_MS) {
        return NextResponse.json(cachedResponse.data);
    }

    let agentsOut: any[] = [];
    let source: "hol-search" | "guarded-fallback" = "hol-search";
    let searchError: string | null = null;

    try {
        const searchUrl = `${HOL_REGISTRY_BASE}/search?q=ascend&limit=10`;
        const res = await fetch(searchUrl, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
            throw new Error(`HOL Registry search failed: ${res.status} ${res.statusText}`);
        }

        const data = await res.json();

        // Extract agent entries - the search API returns different shapes
        const agents = Array.isArray(data)
            ? data
            : Array.isArray(data?.hits)
              ? data.hits
            : Array.isArray(data?.results)
              ? data.results
              : Array.isArray(data?.agents)
                ? data.agents
                : [];

        const ascendAgents = agents
            .filter((a: any) => isAscendAgent(a))
            .map((a: any): HolAgentResponse => {
                const uaid = a.uaid ?? a.profile?.uaid ?? a.metadata?.uaid ?? null;
                return {
                    uaid,
                    name: normalizeAgentName(a.name ?? a.display_name ?? a.profile?.display_name ?? "Unknown"),
                    description: a.description ?? a.profile?.bio ?? "",
                    capabilities: a.capabilities ?? a.profile?.aiAgent?.capabilities ?? [],
                    accountId: a.account_id ?? a.accountId ?? null,
                    inboundTopicId: a.inbound_topic_id ?? a.inboundTopicId ?? null,
                    profileTopicId: a.profile_topic_id ?? a.profileTopicId ?? null,
                    trustScore: a.trust_score ?? a.trustScore ?? null,
                    verified: a.verified ?? false,
                    profileUrl: getHolProfileUrl(uaid),
                };
            });

        agentsOut = ascendAgents;
    } catch (err: any) {
        searchError = err?.message ?? "HOL search failed";
        console.warn(`[HOL API] Search unavailable, using fallback: ${searchError}`);
    }

    // HOL search can lag indexing or timeout; fallback to guarded-registry + local HOL state.
    if (agentsOut.length === 0) {
        const localStates = loadLocalHolStates();
        if (localStates.length > 0) {
            const guardedAgents = await fetchGuardedRegistryAgents(localStates);
            if (guardedAgents.length > 0) {
                agentsOut = guardedAgents as any[];
                source = "guarded-fallback";
            } else {
                agentsOut = localStates.map((s) => ({
                    uaid: null,
                    name: `Ascend: ${s.name}`,
                    description: "HOL profile is registered and awaiting registry indexing.",
                    capabilities: [],
                    accountId: s.accountId,
                    inboundTopicId: s.inboundTopicId,
                    profileTopicId: s.profileTopicId,
                    trustScore: null,
                    verified: false,
                    profileUrl: "https://hol.org/registry",
                }));
                source = "guarded-fallback";
            }
        }
    }

    const responseData = {
        agents: agentsOut,
        total: agentsOut.length,
        source,
        registryUrl: "https://hol.org/registry",
        fetchedAt: new Date().toISOString(),
        error: searchError,
    };

    cachedResponse = { data: responseData, fetchedAt: Date.now() };
    return NextResponse.json(responseData);
}
