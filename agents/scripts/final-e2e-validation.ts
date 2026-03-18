import "dotenv/config";
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { ethers } from "ethers";
import {
    HCS10Client,
    AgentBuilder,
    AIAgentCapability,
    InboundTopicType,
} from "@hashgraphonline/standards-sdk";
import { createContractClient } from "../src/core/contract-client.js";
import { createHCSPublisher } from "../src/core/hcs-publisher.js";
import { DataCollector } from "../src/core/data-collector.js";
import { RoundOrchestrator, type AgentProfile } from "../src/core/round-orchestrator.js";
import { buildDynamicAgentProfiles } from "./lib/round-runtime.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

type LinkCheck = {
    url: string;
    ok: boolean;
    status: number | null;
    error: string | null;
};

type RegisteredAgent = {
    name: string;
    strategyTemplate: string;
    description: string;
    onChainAgentId: number;
    registryTxHash: string;
    registryTxHashscanUrl: string;
    ownerEvm: string;
    ownerHashscanUrl: string;
    active: boolean;
    hol: {
        uaid: string;
        profileUrl: string;
        profileLinkCheck: LinkCheck;
        guardedRegistryTxId: string | null;
        guardedRegistryTxHashscanUrl: string | null;
        accountId: string | null;
        inboundTopicId: string | null;
        outboundTopicId: string | null;
        profileTopicId: string | null;
        hcs10TopicHashscanUrl: string | null;
        hcs11TopicHashscanUrl: string | null;
        hcs10TopicLinkCheck: LinkCheck | null;
        hcs11TopicLinkCheck: LinkCheck | null;
    };
};

type PredictionProof = {
    agentId: number;
    agentName: string;
    commitTxHash: string | null;
    commitTxHashscanUrl: string | null;
    revealTxHash: string | null;
    revealTxHashscanUrl: string | null;
    prediction: "UP" | "DOWN" | "UNKNOWN";
    confidence: number;
    correct: boolean | null;
    credScoreDelta: number | null;
};

type StakeProof = {
    agentId: number;
    agentName: string;
    amountHbar: string;
    stakeTxHash: string;
    stakeTxHashscanUrl: string;
    pendingRewardHbar: string;
    rewardClaimTxHash: string | null;
    rewardClaimTxHashscanUrl: string | null;
};

type HcsReasoningProof = {
    agentId: number;
    agentName: string;
    reasoningTopicId: string;
    reasoningTopicHashscanUrl: string;
    exampleMessage: string | null;
    messageTimestamp: string | null;
};

type PageCheck = {
    route: string;
    status: number;
    ok: boolean;
};

type FinalReport = {
    generatedAt: string;
    network: string;
    contractAddresses: {
        agentRegistry: string;
        predictionMarket: string;
        stakingVault: string;
    };
    registryContractHashscanUrl: string;
    steps: {
        agents: RegisteredAgent[];
        round: {
            roundId: number;
            roundCreationTxHash: string;
            roundCreationTxHashscanUrl: string;
            roundResolutionTxHash: string | null;
            roundResolutionTxHashscanUrl: string | null;
            outcome: "UP" | "DOWN";
            startPrice: string;
            endPrice: string;
            appearedOnLatestRoute: boolean;
        };
        predictions: PredictionProof[];
        hcs: {
            predictionsTopicId: string;
            predictionsTopicHashscanUrl: string;
            resultsTopicId: string;
            resultsTopicHashscanUrl: string;
            perAgentReasoning: HcsReasoningProof[];
        };
        staking: {
            stakes: StakeProof[];
            totalStakedHbar: string;
            totalRewardsClaimedHbar: string;
        };
        systemChecks: {
            pages: PageCheck[];
            agentsVisibleInTopAgentsApi: boolean;
            agentsVisibleInHolApi: boolean;
        };
    };
};

const AGENT_REGISTRY_ABI = [
    "function registerAgent(string name, string description) external payable returns (uint256)",
    "function deactivateAgent(uint256 agentId) external",
    "function getAgent(uint256 agentId) external view returns (tuple(address owner, string name, string description, uint256 totalPredictions, uint256 correctPredictions, int256 credScore, uint256 registrationBond, uint256 totalStaked, uint64 registeredAt, bool active))",
    "function getAgentCount() external view returns (uint256)",
    "event AgentRegistered(uint256 indexed agentId, address indexed owner, string name, uint256 bond)",
];

const PREDICTION_MARKET_ABI = [
    "function getRound(uint256 roundId) external view returns (uint256 startPrice, uint256 endPrice, uint64 commitDeadline, uint64 revealDeadline, uint64 resolveAfter, uint256 entryFee, uint8 status, uint8 outcome, uint8 participantCount, uint8 revealedCount)",
    "event PredictionCommitted(uint256 indexed roundId, uint256 indexed agentId, bytes32 commitHash)",
    "event PredictionRevealed(uint256 indexed roundId, uint256 indexed agentId, uint8 direction, uint256 confidence)",
    "event RoundResolved(uint256 indexed roundId, uint256 endPrice, uint8 outcome)",
    "event ScoreClaimed(uint256 indexed roundId, uint256 indexed agentId, bool correct, int256 delta)",
];

const STAKING_VAULT_ABI = [
    "function stake(uint256 agentId) external payable",
    "function claimReward(uint256 agentId) external",
    "function getPendingReward(uint256 agentId, address user) external view returns (uint256)",
];

function requireEnv(name: string): string {
    const value = String(process.env[name] || "").trim();
    if (!value) {
        throw new Error(`Missing required env: ${name}`);
    }
    return value;
}

function hashscanUrl(entity: "transaction" | "topic" | "contract" | "account", id: string, network: string): string {
    return `https://hashscan.io/${network}/${entity}/${encodeURIComponent(id)}`;
}

function toHbar(valueTinybar: bigint): string {
    return ethers.formatUnits(valueTinybar, 8);
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkUrl(url: string): Promise<LinkCheck> {
    try {
        const res = await fetch(url, {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(20_000),
            headers: {
                "user-agent": "ascend-e2e-validator/1.0",
            },
        });
        return {
            url,
            ok: res.status >= 200 && res.status < 400,
            status: res.status,
            error: null,
        };
    } catch (error: any) {
        return {
            url,
            ok: false,
            status: null,
            error: error?.message || String(error),
        };
    }
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}: ${JSON.stringify(body)}`);
    }
    return body;
}

async function resolveEntityHashscanUrl(
    baseUrl: string,
    kind: "account" | "contract",
    id: string,
    fallbackUrl: string,
): Promise<string> {
    try {
        const resolved = await fetchJson(
            `${baseUrl}/api/mirror/entities/resolve?kind=${kind}&id=${encodeURIComponent(id)}`,
        );
        if (resolved?.success && typeof resolved?.hashscanUrl === "string" && resolved.hashscanUrl) {
            return resolved.hashscanUrl;
        }
        return fallbackUrl;
    } catch {
        return fallbackUrl;
    }
}

function decodeTopicMessage(base64: string): string {
    try {
        return Buffer.from(base64, "base64").toString("utf8");
    } catch {
        return "";
    }
}

async function registerHolWithRetry(
    baseUrl: string,
    payload: { agentName: string; agentDescription: string; onChainAgentId: number },
): Promise<any> {
    let lastResponse: any = null;
    let lastError: string | null = null;
    const apiAttempts = Number.parseInt(process.env.HOL_API_ROUTE_RETRY_ATTEMPTS ?? "2", 10);
    const apiDelayMs = Number.parseInt(process.env.HOL_API_ROUTE_RETRY_DELAY_MS ?? "3000", 10);
    for (let i = 0; i < apiAttempts; i++) {
        try {
            const response = await fetchJson(`${baseUrl}/api/agents/register-hol`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            lastResponse = response;
            if (response?.success) {
                return response;
            }
        } catch (error: any) {
            lastError = error?.message || String(error);
        }
        await wait(apiDelayMs);
    }

    const sanitized = payload.agentName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const statePath = path.resolve(process.cwd(), ".cache", `hol_${sanitized}_state.json`);
    if (fs.existsSync(statePath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
            return {
                success: true,
                cached: true,
                accountId: parsed.accountId ?? null,
                inboundTopicId: parsed.inboundTopicId ?? null,
                outboundTopicId: parsed.outboundTopicId ?? null,
                profileTopicId: parsed.profileTopicId ?? null,
                uaid: parsed.uaid ?? null,
                profileUrl: parsed.uaid
                    ? `https://hol.org/registry/agent/${encodeURIComponent(String(parsed.uaid))}`
                    : null,
                guardedRegistryTxId: parsed.guardedRegistryTxId ?? null,
                guardedRegistryTxHashscanUrl: parsed.guardedRegistryTxId
                    ? hashscanUrl(
                          "transaction",
                          String(parsed.guardedRegistryTxId),
                          String(process.env.HEDERA_NETWORK || "testnet"),
                      )
                    : null,
                onChainAgentId: parsed.onChainAgentId ?? payload.onChainAgentId,
                fallback: "state-cache",
            };
        } catch {
            // Continue to direct SDK fallback.
        }
    }

    // Direct fallback: register with HOL SDK if API route is unavailable.
    const operatorId = requireEnv("HEDERA_OPERATOR_ID");
    const operatorPrivateKey = requireEnv("HEDERA_OPERATOR_KEY");
    const network = String(process.env.HEDERA_NETWORK || "testnet");
    const guardedRegistryBaseUrl = String(
        process.env.HOL_GUARDED_REGISTRY_BASE_URL || "https://moonscape.tech",
    );

    const client = new HCS10Client({
        network: network as "testnet" | "mainnet",
        operatorId,
        operatorPrivateKey,
        guardedRegistryBaseUrl,
        logLevel: "warn",
    });

    const alias = payload.agentName.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
    const builder = new AgentBuilder()
        .setName(`Ascend: ${payload.agentName}`)
        .setAlias(alias)
        .setDescription(payload.agentDescription)
        .setBio(payload.agentDescription.slice(0, 200))
        .setAgentType("autonomous")
        .setCapabilities([
            AIAgentCapability.TEXT_GENERATION,
            AIAgentCapability.MARKET_INTELLIGENCE,
        ])
        .setModel("user-provided")
        .setCreator("Ascend Intelligence Market")
        .setNetwork(network as "testnet" | "mainnet")
        .setInboundTopicType(InboundTopicType.PUBLIC)
        .addProperty("platform", "Ascend Intelligence Market")
        .addProperty("asset", "HBAR/USD")
        .addProperty("onChainAgentId", String(payload.onChainAgentId));

    const result = await client.createAndRegisterAgent(builder, {
        baseUrl: guardedRegistryBaseUrl,
        initialBalance: Number.parseFloat(process.env.HOL_AGENT_INITIAL_BALANCE_HBAR ?? "0.25"),
        maxAttempts: Number.parseInt(process.env.HOL_REGISTRATION_MAX_ATTEMPTS ?? "180", 10),
        delayMs: Number.parseInt(process.env.HOL_REGISTRATION_DELAY_MS ?? "3000", 10),
    } as any);

    if (!result.success || !result.metadata) {
        throw new Error(
            `HOL registration fallback failed for ${payload.agentName}. Last API error=${lastError ?? "none"} fallbackError=${result.error ?? "unknown"}`,
        );
    }

    const resultAny = result as any;
    const guardedRegistryTxId =
        (typeof resultAny.registrationTransactionId === "string" && resultAny.registrationTransactionId) ||
        (typeof resultAny.registrationTxId === "string" && resultAny.registrationTxId) ||
        (typeof resultAny.guardedRegistryTxId === "string" && resultAny.guardedRegistryTxId) ||
        (typeof resultAny.txId === "string" && resultAny.txId) ||
        null;
    const uaid =
        (typeof result.metadata.uaid === "string" && result.metadata.uaid) ||
        (typeof resultAny.uaid === "string" && resultAny.uaid) ||
        null;

    const state = {
        accountId: result.metadata.accountId,
        privateKey: result.metadata.privateKey,
        inboundTopicId: result.metadata.inboundTopicId,
        outboundTopicId: result.metadata.outboundTopicId,
        profileTopicId: result.metadata.profileTopicId,
        uaid,
        guardedRegistryTxId,
        registeredAt: new Date().toISOString(),
        onChainAgentId: payload.onChainAgentId,
    };

    fs.mkdirSync(path.resolve(process.cwd(), ".cache"), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    return {
        success: true,
        cached: false,
        accountId: state.accountId,
        inboundTopicId: state.inboundTopicId,
        outboundTopicId: state.outboundTopicId,
        profileTopicId: state.profileTopicId,
        uaid,
        profileUrl: uaid
            ? `https://hol.org/registry/agent/${encodeURIComponent(String(uaid))}`
            : null,
        guardedRegistryTxId,
        guardedRegistryTxHashscanUrl: guardedRegistryTxId
            ? hashscanUrl("transaction", guardedRegistryTxId, network)
            : null,
        onChainAgentId: payload.onChainAgentId,
        fallback: "direct-sdk",
    };
}

async function main() {
    const network = String(process.env.HEDERA_NETWORK || "testnet").trim() || "testnet";
    const appBaseUrl = String(process.env.ASCEND_APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

    const rpcUrl = requireEnv("HEDERA_JSON_RPC");
    const deployerPkRaw = requireEnv("DEPLOYER_PRIVATE_KEY");
    const deployerPk = deployerPkRaw.startsWith("0x") ? deployerPkRaw : `0x${deployerPkRaw}`;
    const agentRegistryAddress = requireEnv("AGENT_REGISTRY_ADDRESS");
    const predictionMarketAddress = requireEnv("PREDICTION_MARKET_ADDRESS");
    const stakingVaultAddress = requireEnv("STAKING_VAULT_ADDRESS");
    const predictionsTopicId = requireEnv("ASCEND_PREDICTIONS_TOPIC_ID");
    const resultsTopicId = requireEnv("ASCEND_RESULTS_TOPIC_ID");

    // Preflight app API check
    await fetchJson(`${appBaseUrl}/api/protocol/top-agents`);

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(deployerPk, provider);
    const registry = new ethers.Contract(agentRegistryAddress, AGENT_REGISTRY_ABI, signer);
    const market = new ethers.Contract(predictionMarketAddress, PREDICTION_MARKET_ABI, signer);
    const vault = new ethers.Contract(stakingVaultAddress, STAKING_VAULT_ABI, signer);

    const registryHashscanUrl = await resolveEntityHashscanUrl(
        appBaseUrl,
        "contract",
        agentRegistryAddress,
        hashscanUrl("contract", agentRegistryAddress, network),
    );

    // Deterministic run: deactivate existing deployer-owned active agents so
    // the admin selector (first 4 eligible by id) picks this run's agents.
    const existingAgentCount = Number(await registry.getAgentCount());
    if (existingAgentCount > 0) {
        console.log(`▶ Deactivating existing active agents (count=${existingAgentCount}) for deterministic QA run...`);
    }
    for (let i = 1; i <= existingAgentCount; i++) {
        try {
            const existing = await registry.getAgent(i);
            const owner = String(existing.owner || existing[0]).toLowerCase();
            const active = Boolean(existing.active ?? existing[9]);
            if (!active) continue;
            if (owner !== signer.address.toLowerCase()) continue;
            const tx = await registry.deactivateAgent(i, { gasLimit: 200_000 });
            await tx.wait();
        } catch {
            // Ignore non-owned or already deactivated records.
        }
    }

    const suffix = `${Date.now()}`.slice(-6);
    const seedAgents = [
        {
            baseName: `Sentinel-${suffix}`,
            strategyTemplate: "Technical Analysis",
            description:
                "Momentum + volatility framework focused on HBAR/USD direction with confidence-weighted conviction.",
        },
        {
            baseName: `Pulse-${suffix}`,
            strategyTemplate: "Sentiment Analysis",
            description:
                "Market mood and momentum inference from 24h price/volume regime shifts.",
        },
        {
            baseName: `Meridian-${suffix}`,
            strategyTemplate: "Mean Reversion",
            description:
                "Mean reversion model targeting temporary deviations from equilibrium price bands.",
        },
        {
            baseName: `Oracle-${suffix}`,
            strategyTemplate: "Meta-Analysis",
            description:
                "Ensemble intelligence layer synthesizing multiple strategy signals into one prediction.",
        },
    ];

    const registeredAgents: RegisteredAgent[] = [];
    console.log("▶ Registering 4 agents on-chain + HOL...");

    for (const seed of seedAgents) {
        const registerTx = await registry.registerAgent(seed.baseName, seed.description, {
            value: ethers.parseEther("1"),
            gasLimit: 1_500_000,
        });
        const registerReceipt = await registerTx.wait();
        if (!registerReceipt) {
            throw new Error(`No receipt for registration tx ${registerTx.hash}`);
        }

        const parsedLogs = registerReceipt.logs
            .map((log: any) => {
                try {
                    return registry.interface.parseLog({ topics: [...log.topics], data: log.data });
                } catch {
                    return null;
                }
            })
            .filter(Boolean) as any[];

        const registeredEvent = parsedLogs.find((log) => log.name === "AgentRegistered");
        if (!registeredEvent) {
            throw new Error(`AgentRegistered event missing for tx ${registerTx.hash}`);
        }
        const onChainAgentId = Number(registeredEvent.args?.agentId ?? registeredEvent.args?.[0]);
        if (!Number.isFinite(onChainAgentId) || onChainAgentId <= 0) {
            throw new Error(`Invalid agent id emitted for tx ${registerTx.hash}`);
        }

        const onChain = await registry.getAgent(onChainAgentId);
        const ownerEvm = String(onChain.owner || onChain[0]);
        const active = Boolean(onChain.active ?? onChain[9]);
        if (!active) {
            throw new Error(`Agent ${onChainAgentId} is not active after registration`);
        }

        const ownerHashscanUrl = await resolveEntityHashscanUrl(
            appBaseUrl,
            "account",
            ownerEvm,
            hashscanUrl("account", ownerEvm, network),
        );

        const holResponse = await registerHolWithRetry(appBaseUrl, {
            agentName: seed.baseName,
            agentDescription: seed.description,
            onChainAgentId,
        });
        if (!holResponse?.success) {
            throw new Error(`HOL registration failed for ${seed.baseName}: ${JSON.stringify(holResponse)}`);
        }
        const uaid =
            typeof holResponse?.uaid === "string" && holResponse.uaid.trim().length > 0
                ? holResponse.uaid.trim()
                : "MISSING";
        const profileUrl =
            typeof holResponse.profileUrl === "string" && holResponse.profileUrl
                ? holResponse.profileUrl
                : uaid !== "MISSING"
                    ? `https://hol.org/registry/agent/${encodeURIComponent(String(uaid))}`
                    : "https://hol.org/registry";

        const profileLinkCheck = await checkUrl(profileUrl);
        const hcs10TopicHashscanUrl =
            holResponse.inboundTopicId
                ? hashscanUrl("topic", String(holResponse.inboundTopicId), network)
                : null;
        const hcs11TopicHashscanUrl =
            holResponse.profileTopicId
                ? hashscanUrl("topic", String(holResponse.profileTopicId), network)
                : null;

        registeredAgents.push({
            name: seed.baseName,
            strategyTemplate: seed.strategyTemplate,
            description: seed.description,
            onChainAgentId,
            registryTxHash: registerTx.hash,
            registryTxHashscanUrl: hashscanUrl("transaction", registerTx.hash, network),
            ownerEvm,
            ownerHashscanUrl,
            active,
            hol: {
                uaid,
                profileUrl,
                profileLinkCheck,
                guardedRegistryTxId:
                    typeof holResponse.guardedRegistryTxId === "string"
                        ? holResponse.guardedRegistryTxId
                        : null,
                guardedRegistryTxHashscanUrl:
                    typeof holResponse.guardedRegistryTxHashscanUrl === "string"
                        ? holResponse.guardedRegistryTxHashscanUrl
                        : null,
                accountId:
                    typeof holResponse.accountId === "string" ? holResponse.accountId : null,
                inboundTopicId:
                    typeof holResponse.inboundTopicId === "string"
                        ? holResponse.inboundTopicId
                        : null,
                outboundTopicId:
                    typeof holResponse.outboundTopicId === "string"
                        ? holResponse.outboundTopicId
                        : null,
                profileTopicId:
                    typeof holResponse.profileTopicId === "string"
                        ? holResponse.profileTopicId
                        : null,
                hcs10TopicHashscanUrl,
                hcs11TopicHashscanUrl,
                hcs10TopicLinkCheck: hcs10TopicHashscanUrl
                    ? await checkUrl(hcs10TopicHashscanUrl)
                    : null,
                hcs11TopicLinkCheck: hcs11TopicHashscanUrl
                    ? await checkUrl(hcs11TopicHashscanUrl)
                    : null,
            },
        });
    }

    // Verify newly registered agents are visible via frontend APIs.
    const topAgentsPayload = await fetchJson(`${appBaseUrl}/api/protocol/top-agents`);
    const topAgentIds = new Set<number>(
        Array.isArray(topAgentsPayload?.agents)
            ? topAgentsPayload.agents.map((a: any) => Number(a.agentId)).filter((n: number) => Number.isFinite(n))
            : [],
    );
    const agentsVisibleInTopAgentsApi = registeredAgents.every((a) => topAgentIds.has(a.onChainAgentId));

    const holAgentsPayload = await fetchJson(`${appBaseUrl}/api/hol/agents`);
    const holAgentIds = new Set<number>(
        Array.isArray(holAgentsPayload?.agents)
            ? holAgentsPayload.agents
                  .map((a: any) => Number(a.onChainAgentId))
                  .filter((n: number) => Number.isFinite(n) && n > 0)
            : [],
    );
    const agentsVisibleInHolApi = registeredAgents.every((a) => holAgentIds.has(a.onChainAgentId));

    // Stake on at least one agent to validate staking and reward flow.
    console.log("▶ Staking on registered agents...");
    const stakeAmountPerAgent = "0.10";
    const stakingProofs: StakeProof[] = [];
    for (const agent of registeredAgents.slice(0, 1)) {
        const stakeTx = await vault.stake(agent.onChainAgentId, {
            value: ethers.parseEther(stakeAmountPerAgent),
            gasLimit: 350_000,
        });
        await stakeTx.wait();
        stakingProofs.push({
            agentId: agent.onChainAgentId,
            agentName: agent.name,
            amountHbar: stakeAmountPerAgent,
            stakeTxHash: stakeTx.hash,
            stakeTxHashscanUrl: hashscanUrl("transaction", stakeTx.hash, network),
            pendingRewardHbar: "0",
            rewardClaimTxHash: null,
            rewardClaimTxHashscanUrl: null,
        });
    }

    // Start round using Admin API route (same flow as admin panel button).
    console.log("▶ Starting admin round...");
    const roundCreatePayload = await fetchJson(`${appBaseUrl}/api/admin/rounds/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            commitDurationSecs: 35,
            revealDurationSecs: 35,
            roundDurationSecs: 75,
            entryFeeHbar: 0.05,
        }),
    });
    if (!roundCreatePayload?.success) {
        throw new Error(`Admin round creation failed: ${JSON.stringify(roundCreatePayload)}`);
    }

    const roundId = Number(roundCreatePayload.roundId);
    const roundCreationTxHash = String(roundCreatePayload.txHash);
    const roundCreationTxHashscanUrl = String(roundCreatePayload.txHashscanUrl);
    const selectedAgentIds = Array.isArray(roundCreatePayload?.selectedAgents)
        ? roundCreatePayload.selectedAgents.map((a: any) => Number(a.id)).filter((n: number) => Number.isFinite(n))
        : [];
    if (selectedAgentIds.length !== 4) {
        throw new Error(`Expected 4 selected agents, got ${selectedAgentIds.length}`);
    }
    const registeredIds = new Set<number>(registeredAgents.map((a) => a.onChainAgentId));
    const includesOnlyNewAgents = selectedAgentIds.every((id) => registeredIds.has(id));
    if (!includesOnlyNewAgents) {
        throw new Error(
            `Admin selected agents ${selectedAgentIds.join(",")} but expected only newly registered ids ${[
                ...registeredIds,
            ].join(",")}`,
        );
    }

    // Execute round (commit/reveal/resolve) using orchestrator admin path.
    console.log(`▶ Executing round #${roundId} orchestrator flow...`);
    const contracts = createContractClient();
    contracts.refreshNonce();
    const hcs = createHCSPublisher();
    const dataCollector = new DataCollector(process.env.COINGECKO_API_KEY);
    const dynamicProfiles = await buildDynamicAgentProfiles(contracts);
    const selectedProfiles: AgentProfile[] = selectedAgentIds
        .map((id) => dynamicProfiles.find((p) => p.id === id))
        .filter((value): value is AgentProfile => Boolean(value));
    if (selectedProfiles.length !== 4) {
        throw new Error(
            `Could not map all selected agent profiles (found ${selectedProfiles.length}/4).`,
        );
    }

    const orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, selectedProfiles);
    const executed = await orchestrator.executeExistingRound(roundId);
    const outcome = executed.outcome;
    const startPrice = String(executed.startPrice);
    const endPrice = String(executed.endPrice);

    // Extract commit/reveal/resolution/score tx hashes from contract logs.
    const creationReceipt = await provider.getTransactionReceipt(roundCreationTxHash);
    const fromBlock = creationReceipt?.blockNumber ?? (await provider.getBlockNumber()) - 500;
    const toBlock = "latest" as const;

    const commitEvents = await market.queryFilter(market.filters.PredictionCommitted(roundId), fromBlock, toBlock);
    const revealEvents = await market.queryFilter(market.filters.PredictionRevealed(roundId), fromBlock, toBlock);
    const resolvedEvents = await market.queryFilter(market.filters.RoundResolved(roundId), fromBlock, toBlock);
    const scoreEvents = await market.queryFilter(market.filters.ScoreClaimed(roundId), fromBlock, toBlock);

    const commitByAgent = new Map<number, string>();
    for (const event of commitEvents) {
        const agentId = Number(event.args?.agentId ?? event.args?.[1]);
        if (!Number.isFinite(agentId)) continue;
        if (!commitByAgent.has(agentId)) {
            commitByAgent.set(agentId, event.transactionHash);
        }
    }

    const revealByAgent = new Map<number, { txHash: string; direction: "UP" | "DOWN"; confidence: number }>();
    for (const event of revealEvents) {
        const agentId = Number(event.args?.agentId ?? event.args?.[1]);
        if (!Number.isFinite(agentId)) continue;
        if (revealByAgent.has(agentId)) continue;
        const rawDirection = Number(event.args?.direction ?? event.args?.[2]);
        const confidence = Number(event.args?.confidence ?? event.args?.[3] ?? 0);
        revealByAgent.set(agentId, {
            txHash: event.transactionHash,
            direction: rawDirection === 0 ? "UP" : "DOWN",
            confidence,
        });
    }

    const scoreByAgent = new Map<number, { correct: boolean; delta: number }>();
    for (const event of scoreEvents) {
        const agentId = Number(event.args?.agentId ?? event.args?.[1]);
        if (!Number.isFinite(agentId)) continue;
        if (scoreByAgent.has(agentId)) continue;
        const correct = Boolean(event.args?.correct ?? event.args?.[2]);
        const deltaRaw = event.args?.delta ?? event.args?.[3] ?? 0n;
        scoreByAgent.set(agentId, { correct, delta: Number(deltaRaw) });
    }

    const resolutionTxHash = resolvedEvents[0]?.transactionHash ?? null;
    const resolutionTxHashscanUrl = resolutionTxHash
        ? hashscanUrl("transaction", resolutionTxHash, network)
        : null;

    const predictionProofs: PredictionProof[] = registeredAgents.map((agent) => {
        const commitTxHash = commitByAgent.get(agent.onChainAgentId) || null;
        const revealInfo = revealByAgent.get(agent.onChainAgentId);
        const scoreInfo = scoreByAgent.get(agent.onChainAgentId);
        return {
            agentId: agent.onChainAgentId,
            agentName: agent.name,
            commitTxHash,
            commitTxHashscanUrl: commitTxHash ? hashscanUrl("transaction", commitTxHash, network) : null,
            revealTxHash: revealInfo?.txHash || null,
            revealTxHashscanUrl: revealInfo?.txHash
                ? hashscanUrl("transaction", revealInfo.txHash, network)
                : null,
            prediction: revealInfo?.direction ?? "UNKNOWN",
            confidence: revealInfo?.confidence ?? 0,
            correct: scoreInfo?.correct ?? null,
            credScoreDelta: scoreInfo?.delta ?? null,
        };
    });

    // HCS reasoning checks for each participating agent.
    console.log("▶ Verifying HCS reasoning timeline...");
    const mirrorBase = String(process.env.HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com").replace(/\/+$/, "");
    const messagesRes = await fetchJson(
        `${mirrorBase}/api/v1/topics/${encodeURIComponent(predictionsTopicId)}/messages?limit=250&order=desc`,
    );
    const messages = Array.isArray(messagesRes?.messages) ? messagesRes.messages : [];
    const decodedMessages = messages.map((msg: any) => {
        const raw = decodeTopicMessage(String(msg.message || ""));
        try {
            return {
                consensusTimestamp: String(msg.consensus_timestamp || ""),
                parsed: JSON.parse(raw),
                raw,
            };
        } catch {
            return {
                consensusTimestamp: String(msg.consensus_timestamp || ""),
                parsed: null,
                raw,
            };
        }
    });

    const hcsPerAgent: HcsReasoningProof[] = registeredAgents.map((agent) => {
        const match = decodedMessages.find((entry) => {
            const parsed = entry.parsed as any;
            return (
                parsed &&
                parsed.type === "REASONING" &&
                Number(parsed.roundId) === roundId &&
                String(parsed.agentId || "").toLowerCase() === agent.name.toLowerCase()
            );
        });
        return {
            agentId: agent.onChainAgentId,
            agentName: agent.name,
            reasoningTopicId: predictionsTopicId,
            reasoningTopicHashscanUrl: hashscanUrl("topic", predictionsTopicId, network),
            exampleMessage:
                match && match.parsed
                    ? String((match.parsed as any).reasoning || JSON.stringify(match.parsed))
                    : null,
            messageTimestamp: match?.consensusTimestamp || null,
        };
    });

    // Evaluate pending rewards and claim.
    console.log("▶ Checking staking reward distribution...");
    let totalRewardsClaimedTinybar = 0n;
    for (const stake of stakingProofs) {
        const pending = (await vault.getPendingReward(stake.agentId, signer.address)) as bigint;
        stake.pendingRewardHbar = toHbar(pending);
        if (pending > 0n) {
            const claimTx = await vault.claimReward(stake.agentId, { gasLimit: 250_000 });
            await claimTx.wait();
            stake.rewardClaimTxHash = claimTx.hash;
            stake.rewardClaimTxHashscanUrl = hashscanUrl("transaction", claimTx.hash, network);
            totalRewardsClaimedTinybar += pending;
        }
    }

    // Basic page checks for demo pages.
    const pageRoutes = [
        "/agents",
        `/agent/${registeredAgents[0]?.onChainAgentId}`,
        "/round/latest",
        "/rounds",
        "/admin",
    ];
    const pageChecks: PageCheck[] = [];
    for (const route of pageRoutes) {
        const res = await fetch(`${appBaseUrl}${route}`, {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(20_000),
        });
        pageChecks.push({
            route,
            status: res.status,
            ok: res.ok,
        });
    }

    const latestRouteStatus = pageChecks.find((p) => p.route === "/round/latest");
    const appearedOnLatestRoute = Boolean(latestRouteStatus?.ok);

    const report: FinalReport = {
        generatedAt: new Date().toISOString(),
        network,
        contractAddresses: {
            agentRegistry: agentRegistryAddress,
            predictionMarket: predictionMarketAddress,
            stakingVault: stakingVaultAddress,
        },
        registryContractHashscanUrl: registryHashscanUrl,
        steps: {
            agents: registeredAgents,
            round: {
                roundId,
                roundCreationTxHash,
                roundCreationTxHashscanUrl,
                roundResolutionTxHash: resolutionTxHash,
                roundResolutionTxHashscanUrl: resolutionTxHashscanUrl,
                outcome,
                startPrice,
                endPrice,
                appearedOnLatestRoute,
            },
            predictions: predictionProofs,
            hcs: {
                predictionsTopicId,
                predictionsTopicHashscanUrl: hashscanUrl("topic", predictionsTopicId, network),
                resultsTopicId,
                resultsTopicHashscanUrl: hashscanUrl("topic", resultsTopicId, network),
                perAgentReasoning: hcsPerAgent,
            },
            staking: {
                stakes: stakingProofs,
                totalStakedHbar: stakingProofs
                    .reduce((sum, stake) => sum + Number(stake.amountHbar), 0)
                    .toFixed(2),
                totalRewardsClaimedHbar: toHbar(totalRewardsClaimedTinybar),
            },
            systemChecks: {
                pages: pageChecks,
                agentsVisibleInTopAgentsApi,
                agentsVisibleInHolApi,
            },
        },
    };

    const reportDir = path.resolve(process.cwd(), ".cache");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `final-e2e-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log("\n✅ FINAL E2E VALIDATION COMPLETE");
    console.log(`Report: ${reportPath}`);
    console.log(`Round: #${roundId} (${outcome})`);
    console.log(`Creation TX: ${roundCreationTxHash}`);
    console.log(`Resolution TX: ${resolutionTxHash ?? "N/A"}`);
}

main().catch((error) => {
    console.error("❌ Final E2E validation failed");
    console.error(error);
    process.exit(1);
});
