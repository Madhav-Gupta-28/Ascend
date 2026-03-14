import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "path";

import { createContractClient } from "../src/core/contract-client.js";
import { createHCSPublisher } from "../src/core/hcs-publisher.js";
import { DataCollector } from "../src/core/data-collector.js";
import {
    RoundOrchestrator,
    type AgentProfile,
    type RoundConfig,
} from "../src/core/round-orchestrator.js";
import { createHTSClient } from "../src/core/hts-client.js";
import {
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

interface AdminRoundPlanEntry {
    roundId: number;
    selectedAgentIds?: number[];
}

interface AdminRoundPlanFile {
    rounds?: Record<string, AdminRoundPlanEntry>;
}

function getAdminRoundPlanPath(): string {
    return (
        process.env.ASCEND_ADMIN_ROUND_PLAN_PATH ||
        path.resolve(process.cwd(), ".cache/admin_round_plan.json")
    );
}

function loadAdminRoundParticipantIds(roundId: number): number[] | null {
    const file = getAdminRoundPlanPath();
    if (!fs.existsSync(file)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AdminRoundPlanFile;
        const entry = parsed.rounds?.[String(roundId)];
        if (!entry?.selectedAgentIds || entry.selectedAgentIds.length === 0) {
            return null;
        }
        return entry.selectedAgentIds.filter((id) => Number.isInteger(id) && id > 0);
    } catch {
        return null;
    }
}

function capRoster(
    roster: AgentProfile[],
    participantLimit: number,
    revealDurationSecs: number,
    serialTxSecs: number,
    forceAllAgents: boolean,
): AgentProfile[] {
    const sorted = [...roster].sort((a, b) => a.id - b.id);
    const requested = sorted.slice(0, Math.max(1, participantLimit));
    const maxSequentialAgents = Math.max(
        1,
        Math.floor(Math.max(1, revealDurationSecs - 2) / serialTxSecs),
    );
    if (forceAllAgents || requested.length <= maxSequentialAgents) {
        return requested;
    }
    console.log(
        `[orchestrator] Trimming agents from ${requested.length} to ${maxSequentialAgents} for ${revealDurationSecs}s reveal window (single signer mode).`,
    );
    return requested.slice(0, maxSequentialAgents);
}

async function main() {
    const commitDurationSecs = toPositiveInt(process.env.ORCHESTRATOR_COMMIT_SECS, 45);
    const revealDurationSecs = toPositiveInt(process.env.ORCHESTRATOR_REVEAL_SECS, 45);
    const roundDurationSecs = toPositiveInt(process.env.ORCHESTRATOR_ROUND_SECS, 90);
    const entryFeeHbar = toNonNegativeNumber(process.env.ORCHESTRATOR_ENTRY_FEE_HBAR, 0.5);
    const cooldownSecs = toPositiveInt(process.env.ORCHESTRATOR_COOLDOWN_SECS, 15);
    const participantLimit = toPositiveInt(process.env.ORCHESTRATOR_PARTICIPANT_COUNT, 4);
    const adminControl = process.env.ORCHESTRATOR_ADMIN_CONTROL === "true";

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
    let agents: AgentProfile[] = [];

    const buildRoster = async (preferredIds?: number[] | null): Promise<AgentProfile[]> => {
        const discovered = await ensureOwnedAgentProfiles(
            contracts,
            await buildDynamicAgentProfiles(contracts),
        );

        if (preferredIds && preferredIds.length > 0) {
            const map = new Map(discovered.map((agent) => [agent.id, agent]));
            const preferred = preferredIds
                .map((id) => map.get(id))
                .filter((agent): agent is AgentProfile => Boolean(agent));
            if (preferred.length > 0) {
                return capRoster(
                    preferred,
                    participantLimit,
                    revealDurationSecs,
                    serialTxSecs,
                    forceAllAgents,
                );
            }
        }

        return capRoster(
            discovered,
            participantLimit,
            revealDurationSecs,
            serialTxSecs,
            forceAllAgents,
        );
    };

    agents = await buildRoster();
    let orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, agents);

    const htsClient = htsEnabled ? createHTSClient() : null;
    const processedAdminRounds = new Set<number>();

    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Continuous Orchestrator");
    console.log("═══════════════════════════════════════════");
    console.log(`  Mode: ${adminControl ? "ADMIN_CONTROLLED" : "AUTONOMOUS"}`);
    console.log(`  Participants/round: ${participantLimit}`);
    console.log(`  Round duration: ${roundDurationSecs}s (autonomous mode)`);
    console.log(`  Commit: ${commitDurationSecs}s | Reveal: ${revealDurationSecs}s`);
    console.log(`  Entry fee: ${entryFeeHbar} HBAR (autonomous mode)`);
    console.log(`  HTS rewards: ${htsEnabled ? "ENABLED" : "DISABLED"}`);
    if (htsEnabled) {
        console.log(`  HTS reward/winner: ${rewardPerWinnerTokens} tokens`);
    }
    console.log("═══════════════════════════════════════════");

    while (true) {
        const loopStartedAt = Date.now();
        try {
            if (adminControl) {
                const latestRoundId = await contracts.getRoundCount();
                if (latestRoundId === 0) {
                    console.log("[orchestrator] No rounds created yet. Waiting for admin start...");
                } else {
                    const latestRound = await contracts.getRound(latestRoundId);
                    const nowSec = Math.floor(Date.now() / 1000);
                    if (latestRound.status === 2 || latestRound.status === 3) {
                        processedAdminRounds.add(latestRoundId);
                        console.log(
                            `[orchestrator] Latest round #${latestRoundId} already closed (status=${latestRound.status}). Waiting for next admin round...`,
                        );
                    } else if (processedAdminRounds.has(latestRoundId)) {
                        console.log(
                            `[orchestrator] Round #${latestRoundId} already processed in this worker session. Waiting for next round...`,
                        );
                    } else if (nowSec > Number(latestRound.commitDeadline)) {
                        console.warn(
                            `[orchestrator] Admin round #${latestRoundId} commit window already closed; running unattended resolution path.`,
                        );
                        const resolved = await orchestrator.resolveUnattendedRound(
                            latestRoundId,
                            "worker detected closed commit window before execution",
                        );
                        processedAdminRounds.add(latestRoundId);
                        console.log(
                            `[orchestrator] Admin round #${resolved.roundId} unattended resolution complete. Outcome=${resolved.outcome}`,
                        );
                    } else {
                        const plannedIds = loadAdminRoundParticipantIds(latestRoundId);
                        agents = await buildRoster(plannedIds);
                        if (agents.length === 0) {
                            throw new Error("No eligible operator-managed agents available for admin round");
                        }
                        orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, agents);

                        console.log(
                            `[orchestrator] Executing admin round #${latestRoundId} with agents: ${agents.map((a) => `${a.name}(#${a.id})`).join(", ")}`,
                        );
                        const result = await orchestrator.executeExistingRound(latestRoundId);
                        processedAdminRounds.add(latestRoundId);
                        console.log(
                            `[orchestrator] Admin round #${result.roundId} complete. Outcome=${result.outcome}`,
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
                    }
                }
            } else {
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
            const refreshed = await buildRoster();
            if (refreshed.length !== agents.length) {
                console.log(
                    `[orchestrator] Agent roster changed: ${agents.length} → ${refreshed.length}`,
                );
            }
            agents = refreshed;
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
