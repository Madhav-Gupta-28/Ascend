/**
 * Ascend — Auto-HOL Registration API
 *
 * When a user registers an agent on-chain via the frontend, this API route
 * automatically registers it in the Hashgraph Online (HOL) Guarded Registry
 * so it becomes discoverable on hol.org/registry and reachable via HCS-10.
 *
 * POST /api/agents/register-hol
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HOL_GUARDED_REGISTRY_BASE_URL =
    process.env.HOL_GUARDED_REGISTRY_BASE_URL ?? "https://moonscape.tech";

interface RegisterHOLRequest {
    agentName: string;
    agentDescription: string;
    onChainAgentId: number;
}

interface HOLRegistrationState {
    accountId: string;
    privateKey: string;
    inboundTopicId: string;
    outboundTopicId: string;
    profileTopicId: string;
    uaid?: string;
    guardedRegistryTxId?: string;
    registeredAt: string;
    onChainAgentId?: number;
}

function normalizeTxId(input: unknown): string | null {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    return trimmed;
}

function pickGuardedRegistryTxId(result: any): string | null {
    const candidates = [
        result?.registrationTransactionId,
        result?.registrationTxId,
        result?.guardedRegistryTxId,
        result?.txId,
        result?.metadata?.registrationTransactionId,
        result?.metadata?.registrationTxId,
        result?.metadata?.guardedRegistryTxId,
        result?.metadata?.txId,
    ];

    for (const candidate of candidates) {
        const parsed = normalizeTxId(candidate);
        if (parsed) return parsed;
    }

    return null;
}

function buildHolProfileUrl(uaid: string | null | undefined): string {
    if (!uaid) return "https://hol.org/registry";
    return `https://hol.org/registry/agent/${encodeURIComponent(uaid)}`;
}

function buildHashscanTxUrl(txIdOrHash: string, network: string): string {
    return `https://hashscan.io/${network}/transaction/${encodeURIComponent(txIdOrHash)}`;
}

async function fetchGuardedRegistryTransactionId(
    accountId: string,
    network: string,
): Promise<string | null> {
    try {
        const url = `${HOL_GUARDED_REGISTRY_BASE_URL}/api/registrations?accountId=${encodeURIComponent(accountId)}&network=${encodeURIComponent(network)}`;
        const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
            cache: "no-store",
        });
        if (!res.ok) return null;
        const payload = await res.json();
        const regs = Array.isArray(payload?.registrations) ? payload.registrations : [];
        const completed = regs.find((reg: any) => reg?.status === "completed");
        const reg = completed ?? regs[0];
        if (!reg) return null;
        return normalizeTxId(reg.transactionId);
    } catch {
        return null;
    }
}

function getStateDir(): string {
    return (
        process.env.HOL_STATE_DIR ||
        path.resolve(process.cwd(), "..", "agents", ".cache")
    );
}

function stateFilePath(agentName: string): string {
    return path.join(getStateDir(), `hol_${agentName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_state.json`);
}

function loadState(agentName: string): HOLRegistrationState | null {
    const fp = stateFilePath(agentName);
    if (!fs.existsSync(fp)) return null;
    try {
        return JSON.parse(fs.readFileSync(fp, "utf-8")) as HOLRegistrationState;
    } catch {
        return null;
    }
}

function saveState(agentName: string, state: HOLRegistrationState): void {
    const dir = getStateDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFilePath(agentName), JSON.stringify(state, null, 2));
}

export async function POST(req: NextRequest) {
    let body: RegisterHOLRequest;
    try {
        body = (await req.json()) as RegisterHOLRequest;
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const agentName = (body.agentName || "").trim();
    const agentDescription = (body.agentDescription || "").trim();
    const onChainAgentId = body.onChainAgentId ?? -1;

    if (!agentName) {
        return NextResponse.json({ error: "agentName is required" }, { status: 400 });
    }
    if (!agentDescription) {
        return NextResponse.json({ error: "agentDescription is required" }, { status: 400 });
    }

    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    const network = (process.env.HEDERA_NETWORK as "testnet" | "mainnet") ?? "testnet";

    if (!operatorId || !operatorKey) {
        return NextResponse.json(
            { error: "Server missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY" },
            { status: 500 },
        );
    }

    // Idempotency: return cached state if already registered
    const existing = loadState(agentName);
    if (existing) {
        const guardedRegistryTxId =
            existing.guardedRegistryTxId ??
            (await fetchGuardedRegistryTransactionId(existing.accountId, network));
        if (guardedRegistryTxId && existing.guardedRegistryTxId !== guardedRegistryTxId) {
            saveState(agentName, { ...existing, guardedRegistryTxId });
        }
        const profileUrl = buildHolProfileUrl(existing.uaid);
        const guardedRegistryTxHashscanUrl = guardedRegistryTxId
            ? buildHashscanTxUrl(guardedRegistryTxId, network)
            : null;
        return NextResponse.json({
            success: true,
            cached: true,
            accountId: existing.accountId,
            inboundTopicId: existing.inboundTopicId,
            outboundTopicId: existing.outboundTopicId,
            profileTopicId: existing.profileTopicId,
            uaid: existing.uaid ?? null,
            profileUrl,
            guardedRegistryTxId,
            guardedRegistryTxHashscanUrl,
        });
    }

    try {
        // Dynamic import to avoid build issues if SDK not yet installed
        const sdk = await import("@hashgraphonline/standards-sdk");
        const { HCS10Client, AgentBuilder, AIAgentCapability, InboundTopicType } = sdk;

        const client = new HCS10Client({
            network,
            operatorId,
            operatorPrivateKey: operatorKey,
            logLevel: "warn",
        });

        const alias = agentName.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);

        const builder = new AgentBuilder()
            .setName(`Ascend: ${agentName}`)
            .setAlias(alias)
            .setDescription(agentDescription)
            .setBio(agentDescription.slice(0, 200))
            .setAgentType("autonomous")
            .setCapabilities([
                AIAgentCapability.TEXT_GENERATION,
                AIAgentCapability.MARKET_INTELLIGENCE,
            ])
            .setModel("user-provided")
            .setCreator("Ascend Intelligence Market")
            .setNetwork(network)
            .setInboundTopicType(InboundTopicType.PUBLIC);

        builder.addProperty("platform", "Ascend Intelligence Market");
        builder.addProperty("asset", "HBAR/USD");
        if (onChainAgentId > 0) {
            builder.addProperty("onChainAgentId", String(onChainAgentId));
        }

        console.log(`[HOL-API] Registering ${agentName} in HOL Registry...`);

        const result = await client.createAndRegisterAgent(builder, {
            progressCallback: (progress: unknown) => {
                console.log(`[HOL-API] ${agentName}: ${JSON.stringify(progress)}`);
            },
        });

        if (!result.success || !result.metadata) {
            console.error(`[HOL-API] Registration failed for ${agentName}: ${result.error}`);
            return NextResponse.json(
                { success: false, error: result.error ?? "Registration failed" },
                { status: 502 },
            );
        }

        const resultAny = result as any;
        const uaid =
            (typeof result.metadata.uaid === "string" ? result.metadata.uaid : null) ??
            (typeof resultAny.uaid === "string" ? resultAny.uaid : null);
        const guardedRegistryTxId =
            pickGuardedRegistryTxId(resultAny) ??
            (await fetchGuardedRegistryTransactionId(result.metadata.accountId, network));

        const state: HOLRegistrationState = {
            accountId: result.metadata.accountId,
            privateKey: result.metadata.privateKey,
            inboundTopicId: result.metadata.inboundTopicId,
            outboundTopicId: result.metadata.outboundTopicId,
            profileTopicId: result.metadata.profileTopicId,
            uaid: uaid ?? undefined,
            guardedRegistryTxId: guardedRegistryTxId ?? undefined,
            registeredAt: new Date().toISOString(),
            onChainAgentId: onChainAgentId > 0 ? onChainAgentId : undefined,
        };

        // NOTE: createAndRegisterAgent already handles guarded registry registration internally.
        // No need to call registerAgentWithGuardedRegistry separately.

        saveState(agentName, state);

        console.log(`[HOL-API] ${agentName} registered: account=${state.accountId} inbound=${state.inboundTopicId}`);

        const profileUrl = buildHolProfileUrl(uaid);
        const guardedRegistryTxHashscanUrl = guardedRegistryTxId
            ? buildHashscanTxUrl(guardedRegistryTxId, network)
            : null;

        return NextResponse.json({
            success: true,
            cached: false,
            accountId: state.accountId,
            inboundTopicId: state.inboundTopicId,
            outboundTopicId: state.outboundTopicId,
            profileTopicId: state.profileTopicId,
            uaid,
            profileUrl,
            guardedRegistryTxId,
            guardedRegistryTxHashscanUrl,
        });
    } catch (err: any) {
        console.error(`[HOL-API] Error registering ${agentName}: ${err.message}`);
        return NextResponse.json(
            { success: false, error: err.message || "Internal error" },
            { status: 500 },
        );
    }
}
