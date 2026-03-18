import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { AGENT_REGISTRY_ABI, PREDICTION_MARKET_ABI } from "@/lib/contracts";

export interface AdminRoundConfig {
    commitDurationSecs: number;
    revealDurationSecs: number;
    roundDurationSecs: number;
    entryFeeHbar: number;
}

export interface AdminAgentStatus {
    id: number;
    owner: string;
    name: string;
    description: string;
    active: boolean;
    registeredAt: number;
    runtimeReady: boolean;
    operatorOwned: boolean;
    eligibleForAdminRounds: boolean;
}

export interface AdminRoundPlanEntry {
    roundId: number;
    selectedAgentIds: number[];
    selectedAgentNames: string[];
    selectionPolicy: "LATEST_4_ACTIVE_BY_REGISTERED_AT_DESC";
    createdAt: string;
}

interface AdminRoundPlanFile {
    rounds: Record<string, AdminRoundPlanEntry>;
}

const DEFAULT_CONFIG: AdminRoundConfig = {
    commitDurationSecs: 45,
    revealDurationSecs: 45,
    roundDurationSecs: 90,
    entryFeeHbar: 0.5,
};

export const ADMIN_SELECTION_POLICY = "LATEST_4_ACTIVE_BY_REGISTERED_AT_DESC" as const;
const DEFAULT_STALE_GRACE_SECS = 120;

function getRpcUrl(): string {
    return (
        process.env.HEDERA_JSON_RPC ||
        process.env.NEXT_PUBLIC_HEDERA_JSON_RPC ||
        "https://testnet.hashio.io/api"
    );
}

function getAgentRegistryAddress(): string {
    return (
        process.env.AGENT_REGISTRY_ADDRESS ||
        process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ||
        ""
    );
}

function getPredictionMarketAddress(): string {
    return (
        process.env.PREDICTION_MARKET_ADDRESS ||
        process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS ||
        ""
    );
}

function normalizeHexPrivateKey(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function getAdminSigningPrivateKey(): string {
    const candidates = [
        process.env.ASCEND_ADMIN_PRIVATE_KEY,
        process.env.DEPLOYER_PRIVATE_KEY,
        process.env.HEDERA_OPERATOR_KEY,
    ];

    for (const candidate of candidates) {
        const normalized = normalizeHexPrivateKey(candidate || "");
        if (!normalized) continue;
        try {
            new ethers.Wallet(normalized);
            return normalized;
        } catch {
            // Try next candidate
        }
    }

    throw new Error(
        "No valid signing key configured (set ASCEND_ADMIN_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY)",
    );
}

function getOperatorManagedOwnerAddress(): string | null {
    const explicit = (process.env.ASCEND_OPERATOR_OWNER_ADDRESS || "").trim();
    if (explicit) return explicit.toLowerCase();
    const deployerPk = normalizeHexPrivateKey(process.env.DEPLOYER_PRIVATE_KEY || "");
    if (!deployerPk) return null;
    try {
        return new ethers.Wallet(deployerPk).address.toLowerCase();
    } catch {
        return null;
    }
}

function getAdminRoundPlanPath(): string {
    return (
        process.env.ASCEND_ADMIN_ROUND_PLAN_PATH ||
        path.resolve(process.cwd(), "../agents/.cache/admin_round_plan.json")
    );
}

function getStaleRoundGraceSecs(): number {
    const configured = Number(process.env.ASCEND_STALE_ROUND_GRACE_SECS || DEFAULT_STALE_GRACE_SECS);
    if (!Number.isFinite(configured) || configured < 0) {
        return DEFAULT_STALE_GRACE_SECS;
    }
    return Math.floor(configured);
}

function isActiveRoundStatus(status: number): boolean {
    return status === 0 || status === 1;
}

export interface AdminRoundHealthEntry {
    id: number;
    status: number;
    commitDeadline: number;
    revealDeadline: number;
    resolveAfter: number;
    participantCount: number;
    revealedCount: number;
    stale: boolean;
}

export interface AdminRoundHealth {
    roundCount: number;
    latestRoundId: number;
    activeRoundIds: number[];
    staleActiveRoundIds: number[];
    activeRounds: AdminRoundHealthEntry[];
}

function mapRoundHealthEntry(
    roundId: number,
    data: any,
    nowSec: number,
    staleGraceSecs: number,
): AdminRoundHealthEntry {
    const status = Number(data.status ?? data[6] ?? 0);
    const commitDeadline = Number(data.commitDeadline ?? data[2] ?? 0);
    const revealDeadline = Number(data.revealDeadline ?? data[3] ?? 0);
    const resolveAfter = Number(data.resolveAfter ?? data[4] ?? 0);
    const participantCount = Number(data.participantCount ?? data[8] ?? 0);
    const revealedCount = Number(data.revealedCount ?? data[9] ?? 0);
    const stale = isActiveRoundStatus(status) && nowSec > resolveAfter + staleGraceSecs;

    return {
        id: roundId,
        status,
        commitDeadline,
        revealDeadline,
        resolveAfter,
        participantCount,
        revealedCount,
        stale,
    };
}

export async function inspectAdminRoundHealth(): Promise<AdminRoundHealth> {
    const marketAddress = getPredictionMarketAddress();
    if (!marketAddress) {
        throw new Error("PREDICTION_MARKET_ADDRESS not configured");
    }

    const provider = new ethers.JsonRpcProvider(getRpcUrl());
    const market = new ethers.Contract(marketAddress, PREDICTION_MARKET_ABI, provider);
    const roundCount = Number(await market.getRoundCount());
    const latestRoundId = roundCount;
    const nowSec = Math.floor(Date.now() / 1000);
    const staleGraceSecs = getStaleRoundGraceSecs();
    const activeRounds: AdminRoundHealthEntry[] = [];

    for (let roundId = 1; roundId <= roundCount; roundId++) {
        try {
            const data = await market.getRound(roundId);
            const row = mapRoundHealthEntry(roundId, data, nowSec, staleGraceSecs);
            if (isActiveRoundStatus(row.status)) {
                activeRounds.push(row);
            }
        } catch {
            // Ignore unreadable round slots.
        }
    }

    activeRounds.sort((a, b) => b.id - a.id);
    const activeRoundIds = activeRounds.map((round) => round.id);
    const staleActiveRoundIds = activeRounds.filter((round) => round.stale).map((round) => round.id);

    return {
        roundCount,
        latestRoundId,
        activeRoundIds,
        staleActiveRoundIds,
        activeRounds,
    };
}

export async function cleanupStaleAdminRounds(): Promise<
    AdminRoundHealth & {
        cancelledRoundIds: number[];
        cancelledTxHashes: string[];
    }
> {
    const marketAddress = getPredictionMarketAddress();
    if (!marketAddress) {
        throw new Error("PREDICTION_MARKET_ADDRESS not configured");
    }

    const initial = await inspectAdminRoundHealth();
    if (initial.staleActiveRoundIds.length === 0) {
        return {
            ...initial,
            cancelledRoundIds: [],
            cancelledTxHashes: [],
        };
    }

    const provider = new ethers.JsonRpcProvider(getRpcUrl());
    const signer = new ethers.Wallet(getAdminSigningPrivateKey(), provider);
    const market = new ethers.Contract(marketAddress, PREDICTION_MARKET_ABI, signer);

    const cancelledRoundIds: number[] = [];
    const cancelledTxHashes: string[] = [];

    for (const roundId of initial.staleActiveRoundIds) {
        const tx = await market.cancelRound(roundId, { gasLimit: 300_000 });
        const receipt = await tx.wait();
        if (!receipt) {
            throw new Error(`Cleanup failed: no receipt for cancelRound(${roundId})`);
        }
        cancelledRoundIds.push(roundId);
        cancelledTxHashes.push(String(receipt.hash));
    }

    const after = await inspectAdminRoundHealth();
    return {
        ...after,
        cancelledRoundIds,
        cancelledTxHashes,
    };
}

function loadRoundPlanFile(): AdminRoundPlanFile {
    const file = getAdminRoundPlanPath();
    if (!fs.existsSync(file)) {
        return { rounds: {} };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AdminRoundPlanFile;
        return { rounds: parsed.rounds || {} };
    } catch {
        return { rounds: {} };
    }
}

function saveRoundPlanFile(fileData: AdminRoundPlanFile): void {
    const file = getAdminRoundPlanPath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, JSON.stringify(fileData, null, 2));
}

export function saveAdminRoundPlan(entry: AdminRoundPlanEntry): void {
    const data = loadRoundPlanFile();
    data.rounds[String(entry.roundId)] = entry;
    saveRoundPlanFile(data);
}

export function getDefaultAdminRoundConfig(): AdminRoundConfig {
    return { ...DEFAULT_CONFIG };
}

export function parseAdminRoundConfig(input: unknown): AdminRoundConfig {
    const body = (input || {}) as Partial<AdminRoundConfig>;
    const commitDurationSecs = Number(body.commitDurationSecs ?? DEFAULT_CONFIG.commitDurationSecs);
    const revealDurationSecs = Number(body.revealDurationSecs ?? DEFAULT_CONFIG.revealDurationSecs);
    const roundDurationSecs = Number(body.roundDurationSecs ?? DEFAULT_CONFIG.roundDurationSecs);
    const entryFeeHbar = Number(body.entryFeeHbar ?? DEFAULT_CONFIG.entryFeeHbar);

    if (!Number.isFinite(commitDurationSecs) || commitDurationSecs < 10) {
        throw new Error("commitDurationSecs must be >= 10 seconds");
    }
    if (!Number.isFinite(revealDurationSecs) || revealDurationSecs < 10) {
        throw new Error("revealDurationSecs must be >= 10 seconds");
    }
    if (!Number.isFinite(roundDurationSecs) || roundDurationSecs < commitDurationSecs + revealDurationSecs) {
        throw new Error("roundDurationSecs must be >= commit + reveal durations");
    }
    if (!Number.isFinite(entryFeeHbar) || entryFeeHbar < 0) {
        throw new Error("entryFeeHbar must be a non-negative number");
    }

    return {
        commitDurationSecs: Math.floor(commitDurationSecs),
        revealDurationSecs: Math.floor(revealDurationSecs),
        roundDurationSecs: Math.floor(roundDurationSecs),
        entryFeeHbar,
    };
}

export async function fetchAdminAgentStatuses(): Promise<{
    operatorOwnerAddress: string | null;
    allAgents: AdminAgentStatus[];
    eligibleAgents: AdminAgentStatus[];
    selectedAgents: AdminAgentStatus[];
}> {
    const agentRegistryAddress = getAgentRegistryAddress();
    if (!agentRegistryAddress) {
        throw new Error("AGENT_REGISTRY_ADDRESS not configured");
    }

    const provider = new ethers.JsonRpcProvider(getRpcUrl());
    const registry = new ethers.Contract(agentRegistryAddress, AGENT_REGISTRY_ABI, provider);
    let operatorOwnerAddress = getOperatorManagedOwnerAddress();

    const count = Number(await registry.getAgentCount());
    const rawAgents: Array<{
        id: number;
        owner: string;
        name: string;
        description: string;
        active: boolean;
        registeredAt: number;
    }> = [];

    for (let i = 1; i <= count; i++) {
        try {
            const data = await registry.getAgent(i);
            const name = String(data.name || "");

            rawAgents.push({
                id: i,
                owner: String(data.owner || ""),
                name,
                description: String(data.description || ""),
                active: Boolean(data.active),
                registeredAt: Number(data.registeredAt || 0),
            });
        } catch {
            // Skip unreadable agent slots.
        }
    }

    if (!operatorOwnerAddress && rawAgents.length > 0) {
        const ownerCounts = new Map<string, number>();
        for (const agent of rawAgents) {
            if (!agent.active) continue;
            const owner = agent.owner.toLowerCase();
            ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);
        }
        const inferredOwner = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        operatorOwnerAddress = inferredOwner || rawAgents[0].owner.toLowerCase();
    }

    const allAgents: AdminAgentStatus[] = rawAgents.map((agent) => {
        const operatorOwned = operatorOwnerAddress
            ? agent.owner.toLowerCase() === operatorOwnerAddress
            : false;
        const runtimeReady = operatorOwned;
        const eligibleForAdminRounds = agent.active && runtimeReady;
        return {
            ...agent,
            runtimeReady,
            operatorOwned,
            eligibleForAdminRounds,
        };
    });

    allAgents.sort((a, b) => a.id - b.id);
    const eligibleAgents = allAgents
        .filter((agent) => agent.eligibleForAdminRounds)
        .sort((a, b) => {
            if (b.registeredAt !== a.registeredAt) return b.registeredAt - a.registeredAt;
            return b.id - a.id;
        });
    const selectedAgents = eligibleAgents.slice(0, 4);

    return {
        operatorOwnerAddress,
        allAgents,
        eligibleAgents,
        selectedAgents,
    };
}

export async function createAdminRound(config: AdminRoundConfig): Promise<{
    roundId: number;
    txHash: string;
    startPriceUsd: number;
    cancelledStaleRoundIds: number[];
    cancelledStaleRoundTxHashes: string[];
}> {
    const marketAddress = getPredictionMarketAddress();
    if (!marketAddress) {
        throw new Error("PREDICTION_MARKET_ADDRESS not configured");
    }
    const deployerKey = getAdminSigningPrivateKey();

    // Safety gate: stale active rounds are auto-cancelled so only one active round can exist.
    const cleanup = await cleanupStaleAdminRounds();
    if (cleanup.activeRoundIds.length > 0) {
        throw new Error(
            `Cannot create new round while active round(s) exist: ${cleanup.activeRoundIds
                .map((id) => `#${id}`)
                .join(", ")}. Resolve/cancel them first.`,
        );
    }

    const priceRes = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd",
        { signal: AbortSignal.timeout(10_000) },
    );
    if (!priceRes.ok) {
        throw new Error(`Failed to fetch market price (${priceRes.status})`);
    }
    const priceData = await priceRes.json();
    const startPriceUsd = Number(priceData?.["hedera-hashgraph"]?.usd);
    if (!Number.isFinite(startPriceUsd) || startPriceUsd <= 0) {
        throw new Error("Invalid HBAR/USD market price");
    }

    const startPriceContract = BigInt(Math.round(startPriceUsd * 1e8));
    const entryFeeTinybar = ethers.parseUnits(config.entryFeeHbar.toString(), 8);

    const provider = new ethers.JsonRpcProvider(getRpcUrl());
    const signer = new ethers.Wallet(deployerKey, provider);
    const market = new ethers.Contract(marketAddress, PREDICTION_MARKET_ABI, signer);

    const tx = await market.createRound(
        config.commitDurationSecs,
        config.revealDurationSecs,
        config.roundDurationSecs,
        startPriceContract,
        entryFeeTinybar,
        { gasLimit: 400_000 },
    );
    const receipt = await tx.wait();
    if (!receipt) {
        throw new Error("Round creation transaction did not return a receipt");
    }

    let roundId = 0;
    for (const log of receipt.logs) {
        try {
            const parsed = market.interface.parseLog({
                topics: [...log.topics],
                data: log.data,
            });
            if (parsed?.name === "RoundCreated") {
                roundId = Number(parsed.args[0]);
                break;
            }
        } catch {
            // Ignore unrelated log entries.
        }
    }

    if (!roundId) {
        roundId = Number(await market.getRoundCount({ blockTag: "latest" }));
    }

    if (!roundId) {
        throw new Error("Could not resolve created roundId from transaction");
    }

    return {
        roundId,
        txHash: String(receipt.hash),
        startPriceUsd,
        cancelledStaleRoundIds: cleanup.cancelledRoundIds,
        cancelledStaleRoundTxHashes: cleanup.cancelledTxHashes,
    };
}
