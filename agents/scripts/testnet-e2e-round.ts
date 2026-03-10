import * as dotenv from "dotenv";
import * as path from "path";

import { createContractClient } from "../src/core/contract-client.js";
import { createHCSPublisher } from "../src/core/hcs-publisher.js";
import { DataCollector } from "../src/core/data-collector.js";
import { RoundOrchestrator, type RoundConfig } from "../src/core/round-orchestrator.js";
import { createHTSClient } from "../src/core/hts-client.js";
import { MirrorNodeClient } from "../src/core/mirror-node-client.js";
import {
    buildHeuristicAgentProfiles,
    distributeHtsWinnerRewards,
    ensureOwnedAgentProfiles,
} from "./lib/round-runtime.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

function toPositiveInt(input: string | undefined, fallback: number): number {
    const parsed = Number(input ?? "");
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function toNonNegativeNumber(input: string | undefined, fallback: number): number {
    const parsed = Number(input ?? "");
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
}

function toNonNegativeInt(input: string | undefined, fallback: number): number {
    const parsed = Number(input ?? "");
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.floor(parsed);
}

async function verifyHcsMessages(roundId: number): Promise<void> {
    const predictionsTopicId =
        process.env.ASCEND_PREDICTIONS_TOPIC_ID || process.env.ASCEND_ROUNDS_TOPIC_ID;
    const resultsTopicId =
        process.env.ASCEND_RESULTS_TOPIC_ID ||
        process.env.ASCEND_PREDICTIONS_TOPIC_ID ||
        process.env.ASCEND_ROUNDS_TOPIC_ID;

    if (!predictionsTopicId || !resultsTopicId) {
        throw new Error(
            "ASCEND_PREDICTIONS_TOPIC_ID and ASCEND_RESULTS_TOPIC_ID (or legacy ASCEND_ROUNDS_TOPIC_ID) are required",
        );
    }

    const mirror = new MirrorNodeClient(process.env.HEDERA_MIRROR_NODE);
    const retries = 12;
    const delayMs = 2500;

    for (let i = 0; i < retries; i++) {
        const [predictionMessages, resultMessages] = await Promise.all([
            mirror.getTopicMessages(predictionsTopicId, { limit: 200, order: "desc" }),
            mirror.getTopicMessages(resultsTopicId, { limit: 200, order: "desc" }),
        ]);

        const reasoningCount = predictionMessages.filter(
            (m) => m.data?.type === "REASONING" && m.data?.roundId === roundId,
        ).length;
        const hasResult = resultMessages.some(
            (m) => m.data?.type === "RESULT" && m.data?.roundId === roundId,
        );

        if (reasoningCount > 0 && hasResult) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(
        `HCS verification timed out for round ${roundId} (reasoning and/or result not indexed by mirror node yet)`,
    );
}

async function main() {
    const contracts = createContractClient();
    const hcs = createHCSPublisher();
    const dataCollector = new DataCollector(process.env.COINGECKO_API_KEY);
    let agents = await ensureOwnedAgentProfiles(
        contracts,
        buildHeuristicAgentProfiles(),
    );

    const config: RoundConfig = {
        commitDurationSecs: toPositiveInt(process.env.E2E_COMMIT_SECS, 45),
        revealDurationSecs: toPositiveInt(process.env.E2E_REVEAL_SECS, 15),
        roundDurationSecs: toPositiveInt(process.env.E2E_ROUND_SECS, 75),
        entryFeeHbar: toNonNegativeNumber(process.env.E2E_ENTRY_FEE_HBAR, 0),
    };
    const serialTxSecs = toPositiveInt(process.env.E2E_SERIAL_TX_SECS, 6);
    const forceAllAgents = process.env.E2E_FORCE_ALL_AGENTS === "true";
    const maxSequentialAgents = Math.max(
        1,
        Math.floor(Math.max(1, config.revealDurationSecs - 2) / serialTxSecs),
    );
    if (!forceAllAgents && agents.length > maxSequentialAgents) {
        agents = agents.slice(0, maxSequentialAgents);
        console.log(
            `[e2e] Using ${agents.length} agent(s) for ${config.revealDurationSecs}s reveal window in single-signer mode.`,
        );
    }
    const orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, agents);
    console.log(`\n🤖 Operating Agents: ${agents.map((a) => `${a.name}(#${a.id})`).join(", ")}`);

    const htsEnabled = process.env.E2E_HTS_REWARDS_ENABLED === "true";
    const rewardPerWinnerTokens = process.env.E2E_HTS_REWARD_PER_WINNER_TOKENS || "1";
    const htsClient = htsEnabled ? createHTSClient() : null;

    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Testnet E2E Round Test");
    console.log("═══════════════════════════════════════════");
    console.log(
        `  Config: commit=${config.commitDurationSecs}s reveal=${config.revealDurationSecs}s round=${config.roundDurationSecs}s entryFee=${config.entryFeeHbar} HBAR`,
    );
    console.log(`  HTS rewards: ${htsEnabled ? "ENABLED" : "DISABLED"}`);
    console.log("═══════════════════════════════════════════");

    const result = await orchestrator.executeRound(config);
    const round = await contracts.getRound(result.roundId);
    if (round.status !== 2) {
        throw new Error(`Round ${result.roundId} did not resolve (status=${round.status})`);
    }

    if (round.participantCount !== agents.length) {
        throw new Error(
            `Expected ${agents.length} participants, got ${round.participantCount} in round ${result.roundId}`,
        );
    }

    if (result.predictions.length !== agents.length) {
        throw new Error(
            `Expected ${agents.length} revealed predictions, got ${result.predictions.length} in round ${result.roundId}`,
        );
    }

    for (const agent of agents) {
        const commitment = await contracts.getCommitment(result.roundId, agent.id);
        if (!commitment.committed || !commitment.revealed || !commitment.scored) {
            throw new Error(
                `Commitment verification failed for agent ${agent.name} (#${agent.id}) in round ${result.roundId}`,
            );
        }
    }

    await verifyHcsMessages(result.roundId);

    if (htsClient) {
        const tokenInfo = await htsClient.getTokenInfo();
        const rewardResult = await distributeHtsWinnerRewards(
            htsClient,
            result.predictions,
            result.outcome,
            rewardPerWinnerTokens,
        );
        console.log(
            `[e2e] HTS rewards status=${rewardResult.status} total=${htsClient.formatTinyUnits(rewardResult.totalTinyUnits, tokenInfo.decimals)} ${tokenInfo.symbol} winners=${rewardResult.rewardedAgentNames.join(",") || "-"}`,
        );
    }

    console.log("═══════════════════════════════════════════");
    console.log("  ✅ E2E round test passed");
    console.log(`  Round ID: ${result.roundId}`);
    console.log(`  Outcome: ${result.outcome}`);
    console.log(`  Start price: ${DataCollector.contractToPrice(result.startPrice)}`);
    console.log(`  End price: ${DataCollector.contractToPrice(result.endPrice)}`);
    console.log("═══════════════════════════════════════════");
}

main().catch((error) => {
    console.error("❌ E2E round test failed");
    console.error(error);
    process.exit(1);
});
