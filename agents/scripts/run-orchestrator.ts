import * as dotenv from "dotenv";
import * as path from "path";

import { createContractClient } from "../src/core/contract-client.js";
import { createHCSPublisher } from "../src/core/hcs-publisher.js";
import { DataCollector } from "../src/core/data-collector.js";
import { RoundOrchestrator, type RoundConfig } from "../src/core/round-orchestrator.js";
import { createHTSClient } from "../src/core/hts-client.js";
import {
    buildHeuristicAgentProfiles,
    buildDynamicAgentProfiles,
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const commitDurationSecs = toPositiveInt(process.env.ORCHESTRATOR_COMMIT_SECS, 45);
    const revealDurationSecs = toPositiveInt(process.env.ORCHESTRATOR_REVEAL_SECS, 15);
    const roundDurationSecs = toPositiveInt(process.env.ORCHESTRATOR_ROUND_SECS, 75);
    const entryFeeHbar = toNonNegativeNumber(process.env.ORCHESTRATOR_ENTRY_FEE_HBAR, 1);
    const cooldownSecs = toPositiveInt(process.env.ORCHESTRATOR_COOLDOWN_SECS, 15);

    const htsEnabled = process.env.HTS_REWARDS_ENABLED === "true";
    const rewardPerWinnerTokens = process.env.HTS_REWARD_PER_WINNER_TOKENS || "0";
    const serialTxSecs = toPositiveInt(process.env.ORCHESTRATOR_SERIAL_TX_SECS, 6);
    const forceAllAgents = process.env.ORCHESTRATOR_FORCE_ALL_AGENTS === "true";

    const config: RoundConfig = {
        commitDurationSecs,
        revealDurationSecs,
        roundDurationSecs,
        entryFeeHbar,
    };

    const contracts = createContractClient();
    const hcs = createHCSPublisher();
    const dataCollector = new DataCollector(process.env.COINGECKO_API_KEY);
    // Dynamic agent discovery: finds all active agents owned by deployer on-chain
    let agents = await ensureOwnedAgentProfiles(
        contracts,
        await buildDynamicAgentProfiles(contracts),
    );
    const maxSequentialAgents = Math.max(
        1,
        Math.floor(Math.max(1, revealDurationSecs - 2) / serialTxSecs),
    );
    if (!forceAllAgents && agents.length > maxSequentialAgents) {
        console.log(
            `[orchestrator] Trimming active agents from ${agents.length} to ${maxSequentialAgents} for ${revealDurationSecs}s reveal window (single signer mode).`,
        );
        agents = agents.slice(0, maxSequentialAgents);
    }
    let orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, agents);

    const htsClient = htsEnabled ? createHTSClient() : null;

    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Continuous Orchestrator");
    console.log("═══════════════════════════════════════════");
    console.log(`  Round duration: ${roundDurationSecs}s`);
    console.log(`  Commit: ${commitDurationSecs}s | Reveal: ${revealDurationSecs}s`);
    console.log(`  Entry fee: ${entryFeeHbar} HBAR`);
    console.log(`  HTS rewards: ${htsEnabled ? "ENABLED" : "DISABLED"}`);
    if (htsEnabled) {
        console.log(`  HTS reward/winner: ${rewardPerWinnerTokens} tokens`);
    }
    console.log("═══════════════════════════════════════════");

    while (true) {
        const loopStartedAt = Date.now();
        try {
            const result = await orchestrator.executeRound(config);
            console.log(
                `[orchestrator] Round #${result.roundId} complete. Outcome=${result.outcome}`,
            );

            if (htsClient && rewardPerWinnerTokens !== "0") {
                try {
                    const rewardResult = await distributeHtsWinnerRewards(
                        htsClient,
                        result.predictions,
                        result.outcome,
                        rewardPerWinnerTokens,
                    );
                    console.log(
                        `[orchestrator] HTS reward status=${rewardResult.status} totalTinyUnits=${rewardResult.totalTinyUnits.toString()} winners=${rewardResult.rewardedAgentNames.join(",") || "-"}`,
                    );
                } catch (error: any) {
                    console.error(
                        `[orchestrator] HTS reward distribution failed: ${error?.message || String(error)}`,
                    );
                }
            }
        } catch (error: any) {
            console.error(
                `[orchestrator] Round execution failed: ${error?.message || String(error)}`,
            );
        }

        const elapsedSecs = Math.round((Date.now() - loopStartedAt) / 1000);
        console.log(
            `[orchestrator] Sleeping ${cooldownSecs}s before next round (last loop ${elapsedSecs}s)`,
        );
        await sleep(cooldownSecs * 1000);

        // Re-discover agents between rounds so newly registered agents get picked up
        try {
            const refreshed = await ensureOwnedAgentProfiles(
                contracts,
                await buildDynamicAgentProfiles(contracts),
            );
            if (refreshed.length !== agents.length) {
                console.log(
                    `[orchestrator] Agent roster changed: ${agents.length} → ${refreshed.length}`,
                );
            }
            agents = refreshed;
            if (!forceAllAgents && agents.length > maxSequentialAgents) {
                agents = agents.slice(0, maxSequentialAgents);
            }
            orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, agents);
        } catch (refreshErr: any) {
            console.warn(`[orchestrator] Agent re-discovery failed (keeping existing): ${refreshErr.message}`);
        }
    }
}

main().catch((error) => {
    console.error("[orchestrator] Fatal error:", error);
    process.exit(1);
});
