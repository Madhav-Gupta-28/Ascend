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

const AGENT_REGISTRY_ABI = [
    "function registerAgent(string name, string description) external payable returns (uint256)",
    "function getAgent(uint256 agentId) external view returns (tuple(address owner, string name, string description, uint256 totalPredictions, uint256 correctPredictions, int256 credScore, uint256 registrationBond, uint256 totalStaked, uint64 registeredAt, bool active))",
    "function getAgentCount() external view returns (uint256)",
    "event AgentRegistered(uint256 indexed agentId, address indexed owner, string name, uint256 bond)",
];

const PREDICTION_MARKET_ABI = [
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
    if (!value) throw new Error(`Missing env ${name}`);
    return value;
}

function hashscan(entity: "transaction" | "topic" | "contract" | "account", id: string, network: string): string {
    return `https://hashscan.io/${network}/${entity}/${encodeURIComponent(id)}`;
}

function toHbar(tinybar: bigint): string {
    return ethers.formatUnits(tinybar, 8);
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${url}: ${JSON.stringify(body)}`);
    }
    return body;
}

function sanitize(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

async function ensureHolState(agentName: string, description: string, onChainAgentId: number): Promise<any> {
    const statePath = path.resolve(process.cwd(), ".cache", `hol_${sanitize(agentName)}_state.json`);
    if (fs.existsSync(statePath)) {
        return JSON.parse(fs.readFileSync(statePath, "utf8"));
    }

    const network = String(process.env.HEDERA_NETWORK || "testnet");
    const client = new HCS10Client({
        network: network as "testnet" | "mainnet",
        operatorId: requireEnv("HEDERA_OPERATOR_ID"),
        operatorPrivateKey: requireEnv("HEDERA_OPERATOR_KEY"),
        guardedRegistryBaseUrl: process.env.HOL_GUARDED_REGISTRY_BASE_URL || "https://moonscape.tech",
        logLevel: "warn",
    });

    const alias = agentName.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
    const builder = new AgentBuilder()
        .setName(`Ascend: ${agentName}`)
        .setAlias(alias)
        .setDescription(description)
        .setBio(description.slice(0, 200))
        .setAgentType("autonomous")
        .setCapabilities([AIAgentCapability.TEXT_GENERATION, AIAgentCapability.MARKET_INTELLIGENCE])
        .setModel("user-provided")
        .setCreator("Ascend Intelligence Market")
        .setNetwork(network as "testnet" | "mainnet")
        .setInboundTopicType(InboundTopicType.PUBLIC)
        .addProperty("platform", "Ascend Intelligence Market")
        .addProperty("asset", "HBAR/USD")
        .addProperty("onChainAgentId", String(onChainAgentId));

    const result = await client.createAndRegisterAgent(builder, {
        baseUrl: process.env.HOL_GUARDED_REGISTRY_BASE_URL || "https://moonscape.tech",
        initialBalance: Number.parseFloat(process.env.HOL_AGENT_INITIAL_BALANCE_HBAR || "1"),
        maxAttempts: 180,
        delayMs: 3000,
    } as any);
    if (!result.success || !result.metadata) {
        throw new Error(`HOL registration failed for ${agentName}: ${result.error || "unknown"}`);
    }
    const resultAny = result as any;
    const state = {
        accountId: result.metadata.accountId,
        privateKey: result.metadata.privateKey,
        inboundTopicId: result.metadata.inboundTopicId,
        outboundTopicId: result.metadata.outboundTopicId,
        profileTopicId: result.metadata.profileTopicId,
        uaid:
            (typeof result.metadata.uaid === "string" && result.metadata.uaid) ||
            (typeof resultAny.uaid === "string" && resultAny.uaid) ||
            null,
        guardedRegistryTxId:
            (typeof resultAny.registrationTransactionId === "string" && resultAny.registrationTransactionId) ||
            (typeof resultAny.txId === "string" && resultAny.txId) ||
            null,
        registeredAt: new Date().toISOString(),
        onChainAgentId,
    };
    fs.mkdirSync(path.resolve(process.cwd(), ".cache"), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    return state;
}

async function main() {
    const network = String(process.env.HEDERA_NETWORK || "testnet");
    const appBaseUrl = String(process.env.ASCEND_APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
    const rpcUrl = requireEnv("HEDERA_JSON_RPC");
    const pkRaw = requireEnv("DEPLOYER_PRIVATE_KEY");
    const pk = pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`;
    const registryAddress = requireEnv("AGENT_REGISTRY_ADDRESS");
    const marketAddress = requireEnv("PREDICTION_MARKET_ADDRESS");
    const vaultAddress = requireEnv("STAKING_VAULT_ADDRESS");
    const predictionsTopicId = requireEnv("ASCEND_PREDICTIONS_TOPIC_ID");
    const resultsTopicId = requireEnv("ASCEND_RESULTS_TOPIC_ID");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(pk, provider);
    const registry = new ethers.Contract(registryAddress, AGENT_REGISTRY_ABI, signer);
    const market = new ethers.Contract(marketAddress, PREDICTION_MARKET_ABI, signer);
    const vault = new ethers.Contract(vaultAddress, STAKING_VAULT_ABI, signer);

    const suffix = process.env.ASCEND_QA_SUFFIX || "021428";
    const specs = [
        { base: "Sentinel", strategy: "Technical Analysis", description: "Momentum + volatility framework for HBAR/USD directional calls." },
        { base: "Pulse", strategy: "Sentiment Analysis", description: "Sentiment and flow model over 24h HBAR/USD structure." },
        { base: "Meridian", strategy: "Mean Reversion", description: "Contrarian mean-reversion model over intraday volatility bands." },
        { base: "Oracle", strategy: "Meta-Analysis", description: "Ensemble model aggregating multiple strategy signals into one decision." },
    ];

    const count = Number(await registry.getAgentCount());
    const byName = new Map<string, { id: number; owner: string; active: boolean }>();
    for (let i = 1; i <= count; i++) {
        try {
            const a = await registry.getAgent(i);
            byName.set(String(a.name), {
                id: i,
                owner: String(a.owner || a[0]),
                active: Boolean(a.active ?? a[9]),
            });
        } catch {
            // ignore
        }
    }

    const agents: Array<{
        name: string;
        strategy: string;
        description: string;
        agentId: number;
        owner: string;
        active: boolean;
        registryTxHash: string;
        registryTxHashscanUrl: string | null;
        hol: any;
    }> = [];

    for (const spec of specs) {
        const name = `${spec.base}-${suffix}`;
        let id = byName.get(name)?.id ?? 0;
        let owner = byName.get(name)?.owner ?? signer.address;
        let active = Boolean(byName.get(name)?.active);
        let regTxHash = "";

        if (!id || !active) {
            const tx = await registry.registerAgent(name, spec.description, {
                value: ethers.parseEther("1"),
                gasLimit: 1_500_000,
            });
            regTxHash = tx.hash;
            const receipt = await tx.wait();
            const parsed = receipt?.logs
                .map((log: any) => {
                    try {
                        return registry.interface.parseLog({ topics: [...log.topics], data: log.data });
                    } catch {
                        return null;
                    }
                })
                .find((log: any) => log?.name === "AgentRegistered");
            id = Number(parsed?.args?.agentId ?? parsed?.args?.[0]);
            const onChain = await registry.getAgent(id);
            owner = String(onChain.owner || onChain[0]);
            active = Boolean(onChain.active ?? onChain[9]);
        }
        if (!regTxHash) {
            try {
                const latestBlock = await provider.getBlockNumber();
                const fromBlock = Math.max(0, latestBlock - 100_000);
                const filter = registry.filters.AgentRegistered(BigInt(id));
                const regEvents = await registry.queryFilter(filter, fromBlock, latestBlock);
                regTxHash = regEvents[regEvents.length - 1]?.transactionHash || "";
            } catch {
                regTxHash = "";
            }
        }
        const hol = await ensureHolState(name, spec.description, id);

        agents.push({
            name,
            strategy: spec.strategy,
            description: spec.description,
            agentId: id,
            owner,
            active,
            registryTxHash: regTxHash,
            registryTxHashscanUrl: regTxHash ? hashscan("transaction", regTxHash, network) : null,
            hol,
        });
    }

    // Stake on one agent for rewards check.
    const stakeAgent = agents[0];
    const stakeAmountHbar = "0.5";
    const stakeTx = await vault.stake(stakeAgent.agentId, {
        value: ethers.parseEther(stakeAmountHbar),
        gasLimit: 350_000,
    });
    await stakeTx.wait();

    // Start round through admin API.
    const roundCreate = await fetchJson(`${appBaseUrl}/api/admin/rounds/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            commitDurationSecs: 35,
            revealDurationSecs: 35,
            roundDurationSecs: 75,
            entryFeeHbar: 0.1,
        }),
    });
    if (!roundCreate.success) throw new Error(`Round start failed: ${JSON.stringify(roundCreate)}`);
    const roundId = Number(roundCreate.roundId);

    // Execute the created round.
    const contracts = createContractClient();
    contracts.refreshNonce();
    const hcs = createHCSPublisher();
    const dataCollector = new DataCollector(process.env.COINGECKO_API_KEY);
    const dynamic = await buildDynamicAgentProfiles(contracts);
    const selectedIds: number[] = (roundCreate.selectedAgents || []).map((a: any) => Number(a.id));
    const selectedProfiles: AgentProfile[] = selectedIds
        .map((id) => dynamic.find((p) => p.id === id))
        .filter((p): p is AgentProfile => Boolean(p));
    const orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, selectedProfiles);
    const result = await orchestrator.executeExistingRound(roundId);

    const creationReceipt = await provider.getTransactionReceipt(String(roundCreate.txHash));
    const fromBlock = creationReceipt?.blockNumber ?? 0;
    const commitEvents = await market.queryFilter(market.filters.PredictionCommitted(roundId), fromBlock, "latest");
    const revealEvents = await market.queryFilter(market.filters.PredictionRevealed(roundId), fromBlock, "latest");
    const resolvedEvents = await market.queryFilter(market.filters.RoundResolved(roundId), fromBlock, "latest");
    const scoreEvents = await market.queryFilter(market.filters.ScoreClaimed(roundId), fromBlock, "latest");

    const commitMap = new Map<number, string>();
    for (const e of commitEvents) {
        const id = Number(e.args?.agentId ?? e.args?.[1]);
        if (!commitMap.has(id)) commitMap.set(id, e.transactionHash);
    }
    const revealMap = new Map<number, { tx: string; direction: string; confidence: number }>();
    for (const e of revealEvents) {
        const id = Number(e.args?.agentId ?? e.args?.[1]);
        if (revealMap.has(id)) continue;
        const dir = Number(e.args?.direction ?? e.args?.[2]) === 0 ? "UP" : "DOWN";
        const confidence = Number(e.args?.confidence ?? e.args?.[3] ?? 0);
        revealMap.set(id, { tx: e.transactionHash, direction: dir, confidence });
    }
    const scoreMap = new Map<number, { correct: boolean; delta: number }>();
    for (const e of scoreEvents) {
        const id = Number(e.args?.agentId ?? e.args?.[1]);
        if (scoreMap.has(id)) continue;
        scoreMap.set(id, {
            correct: Boolean(e.args?.correct ?? e.args?.[2]),
            delta: Number(e.args?.delta ?? e.args?.[3] ?? 0n),
        });
    }
    const resolutionTxHash = resolvedEvents[0]?.transactionHash || null;

    // HCS reasoning samples
    const mirrorBase = String(process.env.HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com").replace(/\/+$/, "");
    const topicRes = await fetchJson(`${mirrorBase}/api/v1/topics/${predictionsTopicId}/messages?limit=250&order=desc`);
    const topicMessages = Array.isArray(topicRes?.messages) ? topicRes.messages : [];
    const parsedMessages = topicMessages
        .map((m: any) => {
            const raw = Buffer.from(String(m.message || ""), "base64").toString("utf8");
            try {
                return { ts: m.consensus_timestamp, parsed: JSON.parse(raw) };
            } catch {
                return { ts: m.consensus_timestamp, parsed: null };
            }
        })
        .filter((m: any) => m.parsed && m.parsed.type === "REASONING" && Number(m.parsed.roundId) === roundId);

    // Reward claim
    const pending = (await vault.getPendingReward(stakeAgent.agentId, signer.address)) as bigint;
    let claimTxHash: string | null = null;
    if (pending > 0n) {
        const claimTx = await vault.claimReward(stakeAgent.agentId, { gasLimit: 250_000 });
        await claimTx.wait();
        claimTxHash = claimTx.hash;
    }

    const pages = ["/agents", `/agent/${agents[0].agentId}`, "/round/latest", "/rounds", "/admin"];
    const pageChecks = [];
    for (const route of pages) {
        const res = await fetch(`${appBaseUrl}${route}`, { signal: AbortSignal.timeout(20_000) });
        pageChecks.push({ route, status: res.status, ok: res.ok });
    }

    const report = {
        generatedAt: new Date().toISOString(),
        network,
        agents: agents.map((a) => ({
            name: a.name,
            strategy: a.strategy,
            description: a.description,
            agentId: a.agentId,
            active: a.active,
            owner: a.owner,
            ownerHashscanUrl: hashscan("account", a.owner, network),
            registryTxHash: a.registryTxHash,
            registryTxHashscanUrl: a.registryTxHashscanUrl,
            holProfileUrl: a.hol?.uaid
                ? `https://hol.org/registry/agent/${encodeURIComponent(String(a.hol.uaid))}`
                : null,
            holGuardedRegistrationTxId: a.hol?.guardedRegistryTxId ?? null,
            holGuardedRegistrationTxHashscanUrl: a.hol?.guardedRegistryTxId
                ? hashscan("transaction", String(a.hol.guardedRegistryTxId), network)
                : null,
            hcs10TopicId: a.hol?.inboundTopicId ?? null,
            hcs10TopicHashscanUrl: a.hol?.inboundTopicId
                ? hashscan("topic", String(a.hol.inboundTopicId), network)
                : null,
            hcs11TopicId: a.hol?.profileTopicId ?? null,
            hcs11TopicHashscanUrl: a.hol?.profileTopicId
                ? hashscan("topic", String(a.hol.profileTopicId), network)
                : null,
        })),
        round: {
            roundId,
            creationTxHash: String(roundCreate.txHash),
            creationTxHashscanUrl: String(roundCreate.txHashscanUrl),
            resolutionTxHash,
            resolutionTxHashscanUrl: resolutionTxHash
                ? hashscan("transaction", resolutionTxHash, network)
                : null,
            outcome: result.outcome,
            startPrice: String(result.startPrice),
            endPrice: String(result.endPrice),
        },
        predictions: agents.map((a) => ({
            agentId: a.agentId,
            agentName: a.name,
            commitTxHash: commitMap.get(a.agentId) || null,
            commitTxHashscanUrl: commitMap.get(a.agentId)
                ? hashscan("transaction", String(commitMap.get(a.agentId)), network)
                : null,
            revealTxHash: revealMap.get(a.agentId)?.tx || null,
            revealTxHashscanUrl: revealMap.get(a.agentId)?.tx
                ? hashscan("transaction", String(revealMap.get(a.agentId)?.tx), network)
                : null,
            prediction: revealMap.get(a.agentId)?.direction || "UNKNOWN",
            confidence: revealMap.get(a.agentId)?.confidence || 0,
            correct: scoreMap.get(a.agentId)?.correct ?? null,
            credScoreDelta: scoreMap.get(a.agentId)?.delta ?? null,
        })),
        hcs: {
            predictionsTopicId,
            predictionsTopicHashscanUrl: hashscan("topic", predictionsTopicId, network),
            resultsTopicId,
            resultsTopicHashscanUrl: hashscan("topic", resultsTopicId, network),
            reasoningSamples: agents.map((a) => {
                const msg = parsedMessages.find(
                    (m: any) =>
                        String(m.parsed?.agentId || "").toLowerCase() === a.name.toLowerCase(),
                );
                return {
                    agentId: a.agentId,
                    agentName: a.name,
                    messageTimestamp: msg?.ts || null,
                    message: msg?.parsed?.reasoning || null,
                };
            }),
        },
        staking: {
            stakedAgentId: stakeAgent.agentId,
            stakedAgentName: stakeAgent.name,
            stakeAmountHbar,
            stakeTxHash: stakeTx.hash,
            stakeTxHashscanUrl: hashscan("transaction", stakeTx.hash, network),
            pendingRewardHbar: toHbar(pending),
            rewardClaimTxHash: claimTxHash,
            rewardClaimTxHashscanUrl: claimTxHash ? hashscan("transaction", claimTxHash, network) : null,
        },
        checks: {
            pages: pageChecks,
            allSelectedAgentsCommitted: selectedIds.every((id) => commitMap.has(id)),
            allSelectedAgentsRevealed: selectedIds.every((id) => revealMap.has(id)),
        },
    };

    const outPath = path.resolve(process.cwd(), ".cache", `final-e2e-report-resume-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`✅ Final resume validation complete`);
    console.log(`Report: ${outPath}`);
}

main().catch((error) => {
    console.error("❌ Final resume validation failed");
    console.error(error);
    process.exit(1);
});
