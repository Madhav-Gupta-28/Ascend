/**
 * Ascend — Render-Compatible Orchestrator Server
 *
 * Wraps the orchestrator loop in an HTTP server so Render free tier
 * treats it as a web service. The orchestrator sleeps until woken by
 * a POST /wake request (sent by the Vercel admin panel after creating
 * a round on-chain). GET /health keeps Render from spinning down
 * during active round processing.
 *
 * Flow:
 *   1. Admin clicks "Start Round" on Vercel → creates round on-chain
 *   2. Vercel POST /wake → this server wakes orchestrator
 *   3. Orchestrator processes full lifecycle (commit → reveal → resolve)
 *   4. Frontend polls GET /status every 30s → keeps Render alive
 *   5. Round completes → orchestrator idles → Render sleeps (that's fine)
 */

import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "path";
import * as http from "node:http";

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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Admin round plan ─────────────────────────────────────────────────────────

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
    const requested = [...roster].slice(0, Math.max(1, participantLimit));
    const maxSequentialAgents = Math.max(
        1,
        Math.floor(Math.max(1, revealDurationSecs - 2) / serialTxSecs),
    );
    if (forceAllAgents || requested.length <= maxSequentialAgents) {
        return requested;
    }
    console.log(
        `[orchestrator] Trimming agents from ${requested.length} to ${maxSequentialAgents} for ${revealDurationSecs}s reveal window.`,
    );
    return requested.slice(0, maxSequentialAgents);
}

// ── Orchestrator state ───────────────────────────────────────────────────────

type OrchestratorStatus = "idle" | "running" | "error";

let status: OrchestratorStatus = "idle";
let currentRoundId: number | null = null;
let lastResult: { roundId: number; outcome: number | string } | null = null;
let lastError: string | null = null;
let roundsProcessed = 0;

// ── Core orchestrator logic (single pass — not a while loop) ─────────────────

async function runOnePass(
    contracts: ReturnType<typeof createContractClient>,
    hcs: ReturnType<typeof createHCSPublisher>,
    dataCollector: DataCollector,
    htsClient: ReturnType<typeof createHTSClient> | null,
    config: RoundConfig,
    participantLimit: number,
    revealDurationSecs: number,
    serialTxSecs: number,
    forceAllAgents: boolean,
    htsEnabled: boolean,
    rewardPerWinnerTokens: string,
    processedAdminRounds: Set<number>,
) {
    if (status === "running") {
        console.log("[orchestrator] Already running, skipping duplicate wake.");
        return;
    }

    status = "running";
    lastError = null;

    try {
        const adminControl = process.env.ORCHESTRATOR_ADMIN_CONTROL === "true";

        const buildRoster = async (preferredIds?: number[] | null): Promise<AgentProfile[]> => {
            const discovered = await ensureOwnedAgentProfiles(
                contracts,
                await buildDynamicAgentProfiles(contracts),
            );
            if (preferredIds && preferredIds.length > 0) {
                const map = new Map(discovered.map((a) => [a.id, a]));
                const preferred = preferredIds
                    .map((id) => map.get(id))
                    .filter((a): a is AgentProfile => Boolean(a));
                if (preferred.length > 0) {
                    return capRoster(preferred, participantLimit, revealDurationSecs, serialTxSecs, forceAllAgents);
                }
            }
            return capRoster(discovered, participantLimit, revealDurationSecs, serialTxSecs, forceAllAgents);
        };

        const agents = await buildRoster();
        if (agents.length === 0) {
            throw new Error("No eligible operator-managed agents available");
        }

        const orchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, agents);

        if (adminControl) {
            const latestRoundId = await contracts.getRoundCount();
            if (latestRoundId === 0) {
                console.log("[orchestrator] No rounds created yet.");
                status = "idle";
                return;
            }

            const latestRound = await contracts.getRound(latestRoundId);
            currentRoundId = latestRoundId;

            if (latestRound.status === 2 || latestRound.status === 3) {
                processedAdminRounds.add(latestRoundId);
                console.log(`[orchestrator] Round #${latestRoundId} already closed.`);
                status = "idle";
                return;
            }

            if (processedAdminRounds.has(latestRoundId)) {
                console.log(`[orchestrator] Round #${latestRoundId} already processed.`);
                status = "idle";
                return;
            }

            const nowSec = Math.floor(Date.now() / 1000);
            if (nowSec > Number(latestRound.commitDeadline)) {
                console.warn(`[orchestrator] Round #${latestRoundId} commit window closed; resolving unattended.`);
                contracts.refreshNonce();
                await orchestrator.resolveUnattendedRound(latestRoundId, "commit window closed");
                processedAdminRounds.add(latestRoundId);
                status = "idle";
                return;
            }

            // Execute the round
            const plannedIds = loadAdminRoundParticipantIds(latestRoundId);
            const roundAgents = await buildRoster(plannedIds);
            const roundOrchestrator = new RoundOrchestrator(contracts, hcs, dataCollector, roundAgents);
            contracts.refreshNonce();

            console.log(
                `[orchestrator] Executing round #${latestRoundId} with: ${roundAgents.map((a) => `${a.name}(#${a.id})`).join(", ")}`,
            );
            const result = await roundOrchestrator.executeExistingRound(latestRoundId);
            processedAdminRounds.add(latestRoundId);
            lastResult = { roundId: result.roundId, outcome: result.outcome };
            roundsProcessed++;

            console.log(`[orchestrator] Round #${result.roundId} complete. Outcome=${result.outcome}`);

            if (htsClient && rewardPerWinnerTokens !== "0") {
                try {
                    const rewardResult = await distributeHtsWinnerRewards(
                        htsClient, result.predictions, result.outcome, rewardPerWinnerTokens,
                    );
                    console.log(
                        `[orchestrator] HTS reward: status=${rewardResult.status} winners=${rewardResult.rewardedAgentNames.join(",") || "-"}`,
                    );
                } catch (err: any) {
                    console.error(`[orchestrator] HTS reward failed: ${err?.message}`);
                }
            }
        } else {
            // Autonomous mode
            contracts.refreshNonce();
            const result = await orchestrator.executeRound(config);
            lastResult = { roundId: result.roundId, outcome: result.outcome };
            currentRoundId = result.roundId;
            roundsProcessed++;
            console.log(`[orchestrator] Round #${result.roundId} complete. Outcome=${result.outcome}`);

            if (htsClient && rewardPerWinnerTokens !== "0") {
                try {
                    const rewardResult = await distributeHtsWinnerRewards(
                        htsClient, result.predictions, result.outcome, rewardPerWinnerTokens,
                    );
                    console.log(
                        `[orchestrator] HTS reward: status=${rewardResult.status} winners=${rewardResult.rewardedAgentNames.join(",") || "-"}`,
                    );
                } catch (err: any) {
                    console.error(`[orchestrator] HTS reward failed: ${err?.message}`);
                }
            }
        }

        status = "idle";
        currentRoundId = null;
    } catch (error: any) {
        const msg = error?.message || String(error);
        console.error(`[orchestrator] Round failed: ${msg}`);
        lastError = msg;
        status = "error";
        currentRoundId = null;
        // Reset to idle after 10s so next wake can retry
        setTimeout(() => { if (status === "error") status = "idle"; }, 10_000);
    }
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

async function startServer() {
    const commitDurationSecs = toPositiveInt(process.env.ORCHESTRATOR_COMMIT_SECS, 45);
    const revealDurationSecs = toPositiveInt(process.env.ORCHESTRATOR_REVEAL_SECS, 45);
    const roundDurationSecs = toPositiveInt(process.env.ORCHESTRATOR_ROUND_SECS, 90);
    const entryFeeHbar = toNonNegativeNumber(process.env.ORCHESTRATOR_ENTRY_FEE_HBAR, 0.5);
    const participantLimit = toPositiveInt(process.env.ORCHESTRATOR_PARTICIPANT_COUNT, 4);
    const serialTxSecs = toPositiveInt(process.env.ORCHESTRATOR_SERIAL_TX_SECS, 6);
    const forceAllAgents = process.env.ORCHESTRATOR_FORCE_ALL_AGENTS === "true";
    const htsEnabled = process.env.HTS_REWARDS_ENABLED === "true";
    const rewardPerWinnerTokens = process.env.HTS_REWARD_PER_WINNER_TOKENS || "0";

    const config: RoundConfig = {
        commitDurationSecs,
        revealDurationSecs,
        roundDurationSecs,
        entryFeeHbar,
    };

    const contracts = createContractClient();
    const hcs = createHCSPublisher();
    const dataCollector = new DataCollector(process.env.COINGECKO_API_KEY);
    const htsClient = htsEnabled ? createHTSClient() : null;
    const processedAdminRounds = new Set<number>();

    const WAKE_SECRET = process.env.ORCHESTRATOR_WAKE_SECRET || "";

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

        // CORS headers for Vercel frontend
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const json = (statusCode: number, body: object) => {
            res.writeHead(statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify(body));
        };

        // GET /health — keeps Render alive
        if (url.pathname === "/health" || url.pathname === "/") {
            return json(200, {
                service: "ascend-orchestrator",
                status,
                currentRoundId,
                roundsProcessed,
                lastResult,
                lastError,
                uptime: process.uptime(),
            });
        }

        // GET /status — detailed status for frontend polling
        if (url.pathname === "/status") {
            return json(200, {
                status,
                currentRoundId,
                roundsProcessed,
                lastResult,
                lastError,
            });
        }

        // POST /wake — triggers one orchestrator pass
        if (url.pathname === "/wake" && req.method === "POST") {
            // Simple auth check
            if (WAKE_SECRET) {
                const auth = req.headers.authorization || "";
                if (auth !== `Bearer ${WAKE_SECRET}`) {
                    return json(401, { error: "Unauthorized" });
                }
            }

            if (status === "running") {
                return json(200, { message: "Already running", currentRoundId });
            }

            // Fire and forget — respond immediately, process in background
            json(200, { message: "Orchestrator woken", status: "starting" });

            runOnePass(
                contracts, hcs, dataCollector, htsClient, config,
                participantLimit, revealDurationSecs, serialTxSecs,
                forceAllAgents, htsEnabled, rewardPerWinnerTokens,
                processedAdminRounds,
            ).catch((err) => {
                console.error("[server] runOnePass unhandled:", err);
            });
            return;
        }

        json(404, { error: "Not found" });
    });

    const port = Number(process.env.PORT) || 10000;
    server.listen(port, () => {
        console.log("═══════════════════════════════════════════");
        console.log("  ASCEND — Orchestrator Server (Render)");
        console.log("═══════════════════════════════════════════");
        console.log(`  Listening on port ${port}`);
        console.log(`  Mode: ${process.env.ORCHESTRATOR_ADMIN_CONTROL === "true" ? "ADMIN_CONTROLLED" : "AUTONOMOUS"}`);
        console.log(`  Wake secret: ${WAKE_SECRET ? "SET" : "NOT SET (open)"}`);
        console.log(`  Participants/round: ${participantLimit}`);
        console.log(`  HTS rewards: ${htsEnabled ? "ENABLED" : "DISABLED"}`);
        console.log("═══════════════════════════════════════════");
        console.log("  Endpoints:");
        console.log("    GET  /health  — keepalive + status");
        console.log("    GET  /status  — round status");
        console.log("    POST /wake    — trigger orchestrator");
        console.log("═══════════════════════════════════════════");

        // Round polling: check for new rounds every 15 seconds.
        // This is critical because:
        // 1. Render cold-start takes 50+ seconds
        // 2. The /wake POST from Vercel times out before Render finishes booting
        // 3. So the orchestrator needs to discover new rounds on its own
        if (process.env.ORCHESTRATOR_ADMIN_CONTROL === "true") {
            const POLL_INTERVAL_MS = 15_000;
            let lastKnownRoundCount = 0;
            let consecutiveFailures = 0;

            async function pollForRounds() {
                if (status === "running") return; // already processing

                // Back off after consecutive failures (CoinGecko rate limits)
                if (consecutiveFailures > 0) {
                    const skipPolls = Math.min(consecutiveFailures * 2, 12); // max 3 min backoff
                    console.log(`[poll] Backing off: skipping ${skipPolls} polls after ${consecutiveFailures} failures`);
                    consecutiveFailures = 0; // reset, will increment again if next attempt fails
                    return;
                }

                try {
                    const currentCount = await contracts.getRoundCount();
                    if (currentCount > lastKnownRoundCount) {
                        console.log(`[poll] New round detected: #${currentCount} (was ${lastKnownRoundCount})`);
                        lastKnownRoundCount = currentCount;
                        await runOnePass(
                            contracts, hcs, dataCollector, htsClient, config,
                            participantLimit, revealDurationSecs, serialTxSecs,
                            forceAllAgents, htsEnabled, rewardPerWinnerTokens,
                            processedAdminRounds,
                        );
                        consecutiveFailures = 0;
                    } else {
                        // Also check if latest round is still open (in case we missed it)
                        if (currentCount > 0 && !processedAdminRounds.has(currentCount)) {
                            const latestRound = await contracts.getRound(currentCount);
                            if (latestRound.status === 0 || latestRound.status === 1) {
                                console.log(`[poll] Active round #${currentCount} found (status=${latestRound.status})`);
                                await runOnePass(
                                    contracts, hcs, dataCollector, htsClient, config,
                                    participantLimit, revealDurationSecs, serialTxSecs,
                                    forceAllAgents, htsEnabled, rewardPerWinnerTokens,
                                    processedAdminRounds,
                                );
                                consecutiveFailures = 0;
                            }
                        }
                        lastKnownRoundCount = currentCount;
                    }
                } catch (err: any) {
                    consecutiveFailures++;
                    console.warn(`[poll] Error (failure #${consecutiveFailures}):`, err?.message);
                }
            }

            // Initial check
            console.log("[server] Starting round polling (every 15s)...");
            pollForRounds().catch(() => {});
            setInterval(() => { pollForRounds().catch(() => {}); }, POLL_INTERVAL_MS);
        }
    });
}

startServer().catch((error) => {
    console.error("[server] Fatal error:", error);
    process.exit(1);
});
