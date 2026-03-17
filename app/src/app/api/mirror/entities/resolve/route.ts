import { NextRequest, NextResponse } from "next/server";
import {
    getHederaNetwork,
    hashscanAccountUrl,
    hashscanAddressUrl,
    hashscanContractUrl,
    isEvmAddress,
    isHederaId,
} from "@/lib/explorer";

type ResolveKind = "account" | "contract";

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

async function resolveFromMirror(kind: ResolveKind, id: string, mirrorBase: string): Promise<string | null> {
    const endpoint = kind === "contract" ? "contracts" : "accounts";
    const url = `${mirrorBase}/api/v1/${endpoint}/${encodeURIComponent(id)}`;

    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
    });

    if (!response.ok) return null;

    const payload = await response.json();
    if (kind === "contract") {
        const contractId = payload?.contract_id;
        return typeof contractId === "string" && contractId.length > 0 ? contractId : null;
    }

    const accountId = payload?.account;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

export async function GET(request: NextRequest) {
    const kindRaw = request.nextUrl.searchParams.get("kind");
    const id = String(request.nextUrl.searchParams.get("id") || "").trim();

    if (kindRaw !== "account" && kindRaw !== "contract") {
        return NextResponse.json(
            { success: false, error: "kind must be 'account' or 'contract'" },
            { status: 400 },
        );
    }
    const kind = kindRaw as ResolveKind;

    if (!id) {
        return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    const network = getHederaNetwork();
    const mirrorBase = getMirrorNodeBase();

    try {
        if (isHederaId(id)) {
            return NextResponse.json({
                success: true,
                kind,
                input: id,
                resolvedId: id,
                hashscanUrl: kind === "contract" ? hashscanContractUrl(id, network) : hashscanAccountUrl(id, network),
                source: "direct",
            });
        }

        const isAddress = isEvmAddress(id);
        if (!isAddress) {
            return NextResponse.json({
                success: false,
                kind,
                input: id,
                error: "id must be a Hedera entity id (0.0.x) or EVM address",
            }, { status: 400 });
        }

        const resolvedId = await resolveFromMirror(kind, id, mirrorBase);
        if (!resolvedId) {
            return NextResponse.json({
                success: false,
                kind,
                input: id,
                resolvedId: null,
                hashscanUrl: hashscanAddressUrl(id, network),
                source: "fallback-address",
            });
        }

        return NextResponse.json({
            success: true,
            kind,
            input: id,
            resolvedId,
            hashscanUrl: kind === "contract" ? hashscanContractUrl(resolvedId, network) : hashscanAccountUrl(resolvedId, network),
            source: "mirror",
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            kind,
            input: id,
            error: error?.message || "Failed to resolve entity",
        }, { status: 500 });
    }
}

