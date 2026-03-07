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

async function verifyHcsMessages(roundId: number): Promise<void> {
    const topicId = process.env.ASCEND_ROUNDS_TOPIC_ID;
    if (!topicId) {
        throw new Error("ASCEND_ROUNDS_TOPIC_ID not configured");
    }

    const mirror = new MirrorNodeClient(process.env.HEDERA_MIRROR_NODE);
    const messages = await mirror.getTopicMessages(topicId, { limit: 200, order: "desc" });

    const reasoningCount = messages.filter(
        (m) => m.data?.type === "REASONING" && m.data?.roundId === roundId,
    ).length;
    const hasResult = messages.some(
        (m) => m.data?.type === "RESULT" && m.data?.roundId === roundId,
    );

    if (reasoningCount === 0) {
        throw new Error(`No HCS reasoning messages found for round ${roundId}`);
    }
    if (!hasResult) {
        throw new Error(`No HCS result message found for round ${roundId}`);
    }
}

async function main() {
    const contracts = createContractClient();
    const hcs = createHCSPublisher();
    const dataCollector = new DataCollector(process.env.COINGECKO_API_KEY);
    const agents = buildHeuristicAgentProfiles();
    const orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, agents);

    const config: RoundConfig = {
        commitDurationSecs: toPositiveInt(process.env.E2E_COMMIT_SECS, 60),
        revealDurationSecs: toPositiveInt(process.env.E2E_REVEAL_SECS, 30),
        roundDurationSecs: toPositiveInt(process.env.E2E_ROUND_SECS, 120),
        entryFeeHbar: toNonNegativeNumber(process.env.E2E_ENTRY_FEE_HBAR, 0.5),
    };

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

    for (const prediction of result.predictions) {
        const commitment = await contracts.getCommitment(result.roundId, prediction.agentId);
        if (!commitment.committed || !commitment.revealed || !commitment.scored) {
            throw new Error(
                `Commitment verification failed for agent ${prediction.agentName} in round ${result.roundId}`,
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
