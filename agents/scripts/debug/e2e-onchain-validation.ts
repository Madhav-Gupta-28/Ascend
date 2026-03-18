import "dotenv/config";
import * as dotenv from "dotenv";
import * as path from "node:path";
import * as fs from "node:fs";
import { ethers } from "ethers";
import { createContractClient } from "../src/core/contract-client.js";
import { createHCSPublisher } from "../src/core/hcs-publisher.js";
import { DataCollector } from "../src/core/data-collector.js";
import { RoundOrchestrator, type AgentProfile } from "../src/core/round-orchestrator.js";
import { buildDynamicAgentProfiles } from "./lib/round-runtime.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const AGENT_REGISTRY_ABI = [
    "function registerAgent(string name, string description) external payable returns (uint256)",
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

type LinkCheck = {
    url: string;
    ok: boolean;
    status: number | null;
    error: string | null;
};

type RegisteredAgentProof = {
    name: string;
    strategyTemplate: string;
    description: string;
    onChainAgentId: number;
    registrationTxHash: string;
    registrationTxHashscanUrl: string;
    ownerEvmAddress: string;
    ownerHashscanUrl: string;
    active: boolean;
    appearsInFrontendApi: boolean;
    agentPageUrl: string;
    agentPageStatus: number;
};

type PredictionProof = {
    agentId: number;
    agentName: string;
    commitTxHash: string;
    commitTxHashscanUrl: string;
    revealTxHash: string;
    revealTxHashscanUrl: string;
    prediction: "UP" | "DOWN";
    confidence: number;
    outcome: "UP" | "DOWN";
    correct: boolean;
    credScoreDelta: number;
    expectedDelta: number;
    deltaMatchesContractLogic: boolean;
};

type HcsProof = {
    predictionsTopicId: string;
    predictionsTopicHashscanUrl: string;
    resultsTopicId: string;
    resultsTopicHashscanUrl: string;
    reasoningMessagesForRound: number;
    resultMessagesForRound: number;
    sampleReasoningMessage: string | null;
    sampleReasoningTimestamp: string | null;
};

type StakeProof = {
    agentId: number;
    agentName: string;
    amountHbar: string;
    stakeTxHash: string;
    stakeTxHashscanUrl: string;
    pendingRewardBeforeClaimHbar: string;
    rewardClaimTxHash: string | null;
    rewardClaimTxHashscanUrl: string | null;
    rewardClaimedHbar: string;
};

type PageCheck = {
    route: string;
    status: number;
    ok: boolean;
};

type ValidationReport = {
    generatedAt: string;
    network: string;
    appBaseUrl: string;
    contractAddresses: {
        agentRegistry: string;
        predictionMarket: string;
        stakingVault: string;
    };
    registryContractHashscanUrl: string;
    agents: RegisteredAgentProof[];
    round: {
        roundId: number;
        selectedAgentIds: number[];
        selectedAgentNames: string[];
        roundCreationTxHash: string;
        roundCreationTxHashscanUrl: string;
        roundResolutionTxHash: string;
        roundResolutionTxHashscanUrl: string;
        startPriceUsd: string;
        endPriceUsd: string;
        outcome: "UP" | "DOWN";
        appearsOnLatestRoute: boolean;
    };
    predictions: PredictionProof[];
    hcs: HcsProof;
    staking: StakeProof;
    systemChecks: {
        pages: PageCheck[];
        noBrokenProofLinks: boolean;
        checkedProofLinks: LinkCheck[];
    };
};

function requireEnv(name: string): string {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`Missing required env: ${name}`);
    return value;
}

function hashscanUrl(
    entity: "transaction" | "topic" | "contract" | "account" | "address",
    id: string,
    network: string,
): string {
    const normalizedId = String(id || "").trim();
    if (
        entity === "transaction" &&
        (/^\d+\.\d+\.\d+@\d+\.\d+$/.test(normalizedId) || /^\d+\.\d+\.\d+-\d+-\d+$/.test(normalizedId))
    ) {
        return `https://hashscan.io/${network}/tx/${encodeURIComponent(normalizedId)}`;
    }
    return `https://hashscan.io/${network}/${entity}/${encodeURIComponent(id)}`;
}

function toHbar(tinybarValue: bigint): string {
    return ethers.formatUnits(tinybarValue, 8);
}

function directionLabel(raw: number): "UP" | "DOWN" {
    return raw === 0 ? "UP" : "DOWN";
}

function decodeBase64Json(message: string): any | null {
    try {
        const decoded = Buffer.from(message, "base64").toString("utf8");
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${url}: ${JSON.stringify(json)}`);
    }
    return json;
}

async function checkUrl(url: string): Promise<LinkCheck> {
    try {
        const res = await fetch(url, {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(15_000),
            headers: { "user-agent": "ascend-e2e-onchain-validator/1.0" },
        });
        return { url, ok: res.status >= 200 && res.status < 400, status: res.status, error: null };
    } catch (error: any) {
        return { url, ok: false, status: null, error: error?.message || String(error) };
    }
}

async function resolveEntityHashscanUrl(
    appBaseUrl: string,
    kind: "account" | "contract",
    id: string,
    network: string,
): Promise<string> {
    const fallback =
        kind === "account"
            ? hashscanUrl("address", id, network)
            : hashscanUrl("address", id, network);
    try {
        const resolved = await fetchJson(
            `${appBaseUrl}/api/mirror/entities/resolve?kind=${kind}&id=${encodeURIComponent(id)}`,
        );
        if (resolved?.success && typeof resolved?.hashscanUrl === "string" && resolved.hashscanUrl) {
            return resolved.hashscanUrl;
        }
    } catch {
        // fallback
    }
    return fallback;
}

async function resolveTransactionHashscanUrl(
    appBaseUrl: string,
    txHashOrId: string,
    network: string,
): Promise<string> {
    try {
        const resolved = await fetchJson(
            `${appBaseUrl}/api/mirror/transactions/resolve?id=${encodeURIComponent(txHashOrId)}`,
        );
        if (typeof resolved?.hashscanUrl === "string" && resolved.hashscanUrl.length > 0) {
            return resolved.hashscanUrl;
        }
    } catch {
        // fallback
    }
    return hashscanUrl("transaction", txHashOrId, network);
}

async function waitForRoundHcsMessages(
    mirrorNodeBase: string,
    predictionsTopicId: string,
    resultsTopicId: string,
    roundId: number,
): Promise<{
    predictionMessages: any[];
    resultMessages: any[];
}> {
    const retries = 15;
    const delayMs = 2500;
    for (let i = 0; i < retries; i++) {
        const [predPayload, resultPayload] = await Promise.all([
            fetchJson(
                `${mirrorNodeBase}/api/v1/topics/${predictionsTopicId}/messages?order=desc&limit=200`,
            ),
            fetchJson(
                `${mirrorNodeBase}/api/v1/topics/${resultsTopicId}/messages?order=desc&limit=200`,
            ),
        ]);

        const predMessages = Array.isArray(predPayload?.messages) ? predPayload.messages : [];
        const resultsMessages = Array.isArray(resultPayload?.messages) ? resultPayload.messages : [];

        const predForRound = predMessages.filter((entry: any) => {
            const parsed = decodeBase64Json(String(entry?.message || ""));
            return parsed?.type === "REASONING" && Number(parsed?.roundId) === roundId;
        });
        const resultForRound = resultsMessages.filter((entry: any) => {
            const parsed = decodeBase64Json(String(entry?.message || ""));
            return parsed?.type === "RESULT" && Number(parsed?.roundId) === roundId;
        });

        if (predForRound.length > 0 && resultForRound.length > 0) {
            return { predictionMessages: predForRound, resultMessages: resultForRound };
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(`HCS messages for round ${roundId} not indexed in mirror node within timeout`);
}

async function main() {
    const network = String(process.env.HEDERA_NETWORK || "testnet").trim() || "testnet";
    const appBaseUrl = String(process.env.ASCEND_APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
    const mirrorNodeBase = String(process.env.HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com")
        .replace(/\/+$/, "")
        .replace(/\/api\/v1$/, "");

    const rpcUrl = requireEnv("HEDERA_JSON_RPC");
    const deployerPkRaw = requireEnv("DEPLOYER_PRIVATE_KEY");
    const deployerPk = deployerPkRaw.startsWith("0x") ? deployerPkRaw : `0x${deployerPkRaw}`;
    const agentRegistryAddress = requireEnv("AGENT_REGISTRY_ADDRESS");
    const predictionMarketAddress = requireEnv("PREDICTION_MARKET_ADDRESS");
    const stakingVaultAddress = requireEnv("STAKING_VAULT_ADDRESS");
    const predictionsTopicId = requireEnv("ASCEND_PREDICTIONS_TOPIC_ID");
    const resultsTopicId = requireEnv("ASCEND_RESULTS_TOPIC_ID");

    // Preflight app APIs
    await fetchJson(`${appBaseUrl}/api/protocol/top-agents`);
    await fetchJson(`${appBaseUrl}/api/admin/rounds/eligible`);

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(deployerPk, provider);
    const registry = new ethers.Contract(agentRegistryAddress, AGENT_REGISTRY_ABI, signer);
    const market = new ethers.Contract(predictionMarketAddress, PREDICTION_MARKET_ABI, signer);
    const vault = new ethers.Contract(stakingVaultAddress, STAKING_VAULT_ABI, signer);

    const registryContractHashscanUrl = await resolveEntityHashscanUrl(
        appBaseUrl,
        "contract",
        agentRegistryAddress,
        network,
    );

    const runSuffix = `${Date.now()}`.slice(-6);
    const newAgents = [
        {
            name: `Sentinel-${runSuffix}`,
            strategyTemplate: "Technical Analysis",
            description: "Momentum and trend-structure driven HBAR/USD prediction strategy.",
        },
        {
            name: `Pulse-${runSuffix}`,
            strategyTemplate: "Sentiment Analysis",
            description: "24h change/volume regime sentiment model for directional inference.",
        },
        {
            name: `Meridian-${runSuffix}`,
            strategyTemplate: "Mean Reversion",
            description: "Deviation-from-mean model with confidence scaled by volatility.",
        },
        {
            name: `Oracle-${runSuffix}`,
            strategyTemplate: "Meta-Analysis",
            description: "Ensemble model blending trend and volatility into one market call.",
        },
    ];

    const registeredAgents: RegisteredAgentProof[] = [];
    for (const spec of newAgents) {
        const tx = await registry.registerAgent(spec.name, spec.description, {
            value: ethers.parseEther("1"),
            gasLimit: 1_500_000,
        });
        const receipt = await tx.wait();
        if (!receipt) throw new Error(`No receipt for registration tx ${tx.hash}`);

        const parsed = receipt.logs
            .map((log: any) => {
                try {
                    return registry.interface.parseLog({ topics: [...log.topics], data: log.data });
                } catch {
                    return null;
                }
            })
            .filter(Boolean) as any[];

        const event = parsed.find((entry) => entry.name === "AgentRegistered");
        if (!event) throw new Error(`AgentRegistered event not found for tx ${tx.hash}`);

        const onChainAgentId = Number(event.args?.agentId ?? event.args?.[0]);
        const onChainAgent = await registry.getAgent(onChainAgentId);
        const owner = String(onChainAgent.owner || onChainAgent[0]);
        const active = Boolean(onChainAgent.active ?? onChainAgent[9]);
        if (!active) throw new Error(`Agent #${onChainAgentId} is not active after registration`);

        const registrationTxHashscanUrl = await resolveTransactionHashscanUrl(appBaseUrl, tx.hash, network);
        const ownerHashscanUrl = await resolveEntityHashscanUrl(appBaseUrl, "account", owner, network);
        const agentPageUrl = `${appBaseUrl}/agent/${onChainAgentId}`;
        const agentPageRes = await fetch(agentPageUrl, { redirect: "follow", signal: AbortSignal.timeout(20_000) });

        registeredAgents.push({
            name: spec.name,
            strategyTemplate: spec.strategyTemplate,
            description: spec.description,
            onChainAgentId,
            registrationTxHash: tx.hash,
            registrationTxHashscanUrl,
            ownerEvmAddress: owner,
            ownerHashscanUrl,
            active,
            appearsInFrontendApi: false,
            agentPageUrl,
            agentPageStatus: agentPageRes.status,
        });
    }

    const topAgents = await fetchJson(`${appBaseUrl}/api/protocol/top-agents`);
    const topAgentIds = new Set<number>(
        Array.isArray(topAgents?.agents)
            ? topAgents.agents.map((entry: any) => Number(entry.agentId)).filter((n: number) => Number.isFinite(n))
            : [],
    );
    for (const agent of registeredAgents) {
        agent.appearsInFrontendApi = topAgentIds.has(agent.onChainAgentId);
    }

    // Start round via admin API (same action as Admin panel button)
    const roundCreate = await fetchJson(`${appBaseUrl}/api/admin/rounds/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            commitDurationSecs: 40,
            revealDurationSecs: 40,
            roundDurationSecs: 85,
            entryFeeHbar: 0.05,
        }),
    });
    if (!roundCreate?.success) {
        throw new Error(`Admin round start failed: ${JSON.stringify(roundCreate)}`);
    }

    const roundId = Number(roundCreate.roundId);
    const roundCreationTxHash = String(roundCreate.txHash);
    const roundCreationTxHashscanUrl = await resolveTransactionHashscanUrl(
        appBaseUrl,
        roundCreationTxHash,
        network,
    );
    const selectedAgentIds = Array.isArray(roundCreate?.selectedAgents)
        ? roundCreate.selectedAgents.map((entry: any) => Number(entry.id)).filter((n: number) => Number.isFinite(n))
        : [];
    const selectedAgentNames = Array.isArray(roundCreate?.selectedAgents)
        ? roundCreate.selectedAgents.map((entry: any) => String(entry.name || `Agent-${entry.id}`))
        : [];
    if (selectedAgentIds.length !== 4) {
        throw new Error(`Expected 4 selected agents for round #${roundId}, got ${selectedAgentIds.length}`);
    }

    // Stake before round execution so rewards are attributable.
    const stakedAgentId = selectedAgentIds[0];
    const stakedAgentName = selectedAgentNames[0] || `Agent-${stakedAgentId}`;
    const stakeAmountHbar = "0.25";
    const stakeTx = await vault.stake(stakedAgentId, {
        value: ethers.parseEther(stakeAmountHbar),
        gasLimit: 350_000,
    });
    await stakeTx.wait();
    const stakeTxHashscanUrl = await resolveTransactionHashscanUrl(appBaseUrl, stakeTx.hash, network);

    // Execute commit/reveal/resolve flow for the created round.
    const contracts = createContractClient();
    contracts.refreshNonce();
    const hcs = createHCSPublisher();
    const dataCollector = new DataCollector(process.env.COINGECKO_API_KEY);
    const dynamicProfiles = await buildDynamicAgentProfiles(contracts);

    const selectedProfiles: AgentProfile[] = selectedAgentIds.map((id) => {
        const existing = dynamicProfiles.find((profile) => profile.id === id);
        if (existing) return existing;
        return {
            id,
            name: `Agent-${id}`,
            analyze: async (marketData) => {
                const direction = marketData.price.change24hPct >= 0 ? "UP" : "DOWN";
                const confidence = Math.max(45, Math.min(90, Math.round(60 + Math.abs(marketData.price.change24hPct) * 4)));
                return {
                    direction,
                    confidence,
                    reasoning: `Fallback analyzer for agent ${id}: 24h delta ${marketData.price.change24hPct.toFixed(2)}%`,
                };
            },
        };
    });

    const orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, selectedProfiles);
    const executed = await orchestrator.executeExistingRound(roundId);
    const outcome = executed.outcome;

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
        if (Number.isFinite(agentId) && !commitByAgent.has(agentId)) {
            commitByAgent.set(agentId, event.transactionHash);
        }
    }

    const revealByAgent = new Map<number, { txHash: string; direction: "UP" | "DOWN"; confidence: number }>();
    for (const event of revealEvents) {
        const agentId = Number(event.args?.agentId ?? event.args?.[1]);
        if (!Number.isFinite(agentId) || revealByAgent.has(agentId)) continue;
        const directionRaw = Number(event.args?.direction ?? event.args?.[2]);
        const confidence = Number(event.args?.confidence ?? event.args?.[3] ?? 0);
        revealByAgent.set(agentId, {
            txHash: event.transactionHash,
            direction: directionLabel(directionRaw),
            confidence,
        });
    }

    const scoreByAgent = new Map<number, { correct: boolean; delta: number }>();
    for (const event of scoreEvents) {
        const agentId = Number(event.args?.agentId ?? event.args?.[1]);
        if (!Number.isFinite(agentId) || scoreByAgent.has(agentId)) continue;
        const correct = Boolean(event.args?.correct ?? event.args?.[2]);
        const deltaRaw = event.args?.delta ?? event.args?.[3] ?? 0n;
        scoreByAgent.set(agentId, { correct, delta: Number(deltaRaw) });
    }

    const resolutionTxHash = resolvedEvents[0]?.transactionHash;
    if (!resolutionTxHash) {
        throw new Error(`No RoundResolved event found for round #${roundId}`);
    }
    const resolutionTxHashscanUrl = await resolveTransactionHashscanUrl(appBaseUrl, resolutionTxHash, network);

    const roundOnChain = await market.getRound(roundId);
    const startPriceUsd = ethers.formatUnits(BigInt(roundOnChain.startPrice ?? roundOnChain[0]), 8);
    const endPriceUsd = ethers.formatUnits(BigInt(roundOnChain.endPrice ?? roundOnChain[1]), 8);

    const predictionProofs: PredictionProof[] = [];
    for (const [index, agentId] of selectedAgentIds.entries()) {
        const agentName = selectedAgentNames[index] || `Agent-${agentId}`;
        const commitTxHash = commitByAgent.get(agentId);
        const reveal = revealByAgent.get(agentId);
        const score = scoreByAgent.get(agentId);
        if (!commitTxHash) throw new Error(`Missing commit tx for agent #${agentId} in round #${roundId}`);
        if (!reveal) throw new Error(`Missing reveal tx for agent #${agentId} in round #${roundId}`);
        if (!score) throw new Error(`Missing score claim for agent #${agentId} in round #${roundId}`);

        const expectedCorrect = reveal.direction === outcome;
        const expectedDelta = expectedCorrect ? reveal.confidence : -reveal.confidence;
        predictionProofs.push({
            agentId,
            agentName,
            commitTxHash,
            commitTxHashscanUrl: await resolveTransactionHashscanUrl(appBaseUrl, commitTxHash, network),
            revealTxHash: reveal.txHash,
            revealTxHashscanUrl: await resolveTransactionHashscanUrl(appBaseUrl, reveal.txHash, network),
            prediction: reveal.direction,
            confidence: reveal.confidence,
            outcome,
            correct: score.correct,
            credScoreDelta: score.delta,
            expectedDelta,
            deltaMatchesContractLogic: score.delta === expectedDelta && score.correct === expectedCorrect,
        });
    }

    const hcsMessages = await waitForRoundHcsMessages(
        mirrorNodeBase,
        predictionsTopicId,
        resultsTopicId,
        roundId,
    );
    const sampleReasoningRaw = hcsMessages.predictionMessages[0];
    const sampleReasoning = sampleReasoningRaw
        ? decodeBase64Json(String(sampleReasoningRaw.message || ""))
        : null;

    const pendingRewardBeforeClaimTinybar = BigInt(
        await vault.getPendingReward(stakedAgentId, signer.address),
    );
    let rewardClaimTxHash: string | null = null;
    let rewardClaimTxHashscanUrl: string | null = null;
    if (pendingRewardBeforeClaimTinybar > 0n) {
        const claimTx = await vault.claimReward(stakedAgentId, { gasLimit: 350_000 });
        await claimTx.wait();
        rewardClaimTxHash = claimTx.hash;
        rewardClaimTxHashscanUrl = await resolveTransactionHashscanUrl(appBaseUrl, claimTx.hash, network);
    }

    const latestRoundPage = await fetch(`${appBaseUrl}/round/latest`, {
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
    });

    const pageRoutes = [
        "/agents",
        `/agent/${registeredAgents[0].onChainAgentId}`,
        "/round/latest",
        "/rounds",
        "/admin",
    ];
    const pageChecks: PageCheck[] = await Promise.all(
        pageRoutes.map(async (route) => {
            const res = await fetch(`${appBaseUrl}${route}`, {
                redirect: "follow",
                signal: AbortSignal.timeout(20_000),
            });
            return { route, status: res.status, ok: res.status >= 200 && res.status < 400 };
        }),
    );

    const proofLinks = [
        registryContractHashscanUrl,
        roundCreationTxHashscanUrl,
        resolutionTxHashscanUrl,
        stakeTxHashscanUrl,
        ...registeredAgents.map((a) => a.registrationTxHashscanUrl),
        ...registeredAgents.map((a) => a.ownerHashscanUrl),
        ...predictionProofs.map((p) => p.commitTxHashscanUrl),
        ...predictionProofs.map((p) => p.revealTxHashscanUrl),
        hashscanUrl("topic", predictionsTopicId, network),
        hashscanUrl("topic", resultsTopicId, network),
        ...(rewardClaimTxHashscanUrl ? [rewardClaimTxHashscanUrl] : []),
    ];
    const checkedProofLinks = await Promise.all(
        [...new Set(proofLinks)].map((url) => checkUrl(url)),
    );
    const noBrokenProofLinks = checkedProofLinks.every((link) => link.ok);

    const report: ValidationReport = {
        generatedAt: new Date().toISOString(),
        network,
        appBaseUrl,
        contractAddresses: {
            agentRegistry: agentRegistryAddress,
            predictionMarket: predictionMarketAddress,
            stakingVault: stakingVaultAddress,
        },
        registryContractHashscanUrl,
        agents: registeredAgents,
        round: {
            roundId,
            selectedAgentIds,
            selectedAgentNames,
            roundCreationTxHash,
            roundCreationTxHashscanUrl,
            roundResolutionTxHash: resolutionTxHash,
            roundResolutionTxHashscanUrl: resolutionTxHashscanUrl,
            startPriceUsd,
            endPriceUsd,
            outcome,
            appearsOnLatestRoute: latestRoundPage.status >= 200 && latestRoundPage.status < 400,
        },
        predictions: predictionProofs,
        hcs: {
            predictionsTopicId,
            predictionsTopicHashscanUrl: hashscanUrl("topic", predictionsTopicId, network),
            resultsTopicId,
            resultsTopicHashscanUrl: hashscanUrl("topic", resultsTopicId, network),
            reasoningMessagesForRound: hcsMessages.predictionMessages.length,
            resultMessagesForRound: hcsMessages.resultMessages.length,
            sampleReasoningMessage:
                typeof sampleReasoning?.reasoning === "string"
                    ? sampleReasoning.reasoning
                    : sampleReasoning
                        ? JSON.stringify(sampleReasoning)
                        : null,
            sampleReasoningTimestamp:
                typeof sampleReasoningRaw?.consensus_timestamp === "string"
                    ? sampleReasoningRaw.consensus_timestamp
                    : null,
        },
        staking: {
            agentId: stakedAgentId,
            agentName: stakedAgentName,
            amountHbar: stakeAmountHbar,
            stakeTxHash: stakeTx.hash,
            stakeTxHashscanUrl,
            pendingRewardBeforeClaimHbar: toHbar(pendingRewardBeforeClaimTinybar),
            rewardClaimTxHash,
            rewardClaimTxHashscanUrl,
            rewardClaimedHbar: toHbar(pendingRewardBeforeClaimTinybar),
        },
        systemChecks: {
            pages: pageChecks,
            noBrokenProofLinks,
            checkedProofLinks,
        },
    };

    const outDir = path.resolve(process.cwd(), ".cache");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.resolve(outDir, `onchain-e2e-report-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log("\n══════════════════════════════════════════════════");
    console.log("ASCEND ON-CHAIN E2E VALIDATION COMPLETE");
    console.log("══════════════════════════════════════════════════");
    console.log(`Report: ${outPath}`);
    console.log(`Registered agents: ${report.agents.length}`);
    console.log(`Round: #${report.round.roundId} outcome=${report.round.outcome}`);
    console.log(`Proof links healthy: ${report.systemChecks.noBrokenProofLinks}`);
    console.log("══════════════════════════════════════════════════");
}

main().catch((error) => {
    console.error("❌ On-chain E2E validation failed");
    console.error(error);
    process.exit(1);
});
