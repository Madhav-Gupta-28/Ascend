/**
 * Ascend — End-to-End Verification Script
 *
 * Validates the full Ascend pipeline is operational:
 * 1. Environment variables
 * 2. Smart contract connectivity
 * 3. On-chain agent state
 * 4. HOL registration state
 * 5. HCS topic configuration
 * 6. HTS token configuration
 * 7. Round execution capability
 *
 * Usage: npx tsx scripts/verify-e2e.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "node:fs";
import { createContractClient } from "../src/core/contract-client.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

interface CheckResult {
    name: string;
    status: "PASS" | "FAIL" | "WARN";
    detail: string;
}

const results: CheckResult[] = [];

function pass(name: string, detail: string) {
    results.push({ name, status: "PASS", detail });
}
function fail(name: string, detail: string) {
    results.push({ name, status: "FAIL", detail });
}
function warn(name: string, detail: string) {
    results.push({ name, status: "WARN", detail });
}

async function main() {
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  ASCEND — End-to-End Verification               ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log();

    // ── 1. Environment Variables ──
    console.log("1. Checking environment variables...");

    const requiredEnvVars = [
        "HEDERA_OPERATOR_ID",
        "HEDERA_OPERATOR_KEY",
        "DEPLOYER_PRIVATE_KEY",
        "HEDERA_JSON_RPC",
        "HEDERA_MIRROR_NODE",
    ];

    for (const envVar of requiredEnvVars) {
        if (process.env[envVar]) {
            pass(`ENV: ${envVar}`, "Set");
        } else {
            fail(`ENV: ${envVar}`, "MISSING");
        }
    }

    if (process.env.GEMINI_API_KEY) {
        pass("ENV: GEMINI_API_KEY", "Set (LLM analysis enabled)");
    } else {
        warn("ENV: GEMINI_API_KEY", "Missing — LLM agents will use heuristic fallback");
    }

    // ── 2. Contract Addresses ──
    console.log("2. Checking contract addresses...");

    const contractVars = [
        "AGENT_REGISTRY_ADDRESS",
        "PREDICTION_MARKET_ADDRESS",
        "STAKING_VAULT_ADDRESS",
    ];

    for (const v of contractVars) {
        if (process.env[v]) {
            pass(`CONTRACT: ${v}`, process.env[v]!);
        } else {
            fail(`CONTRACT: ${v}`, "MISSING — deploy contracts first");
        }
    }

    // ── 3. Smart Contract Connectivity ──
    console.log("3. Checking smart contract connectivity...");

    let contracts: ReturnType<typeof createContractClient> | null = null;
    try {
        contracts = createContractClient();
        const agentCount = await contracts.getAgentCount();
        pass("CONTRACT: AgentRegistry.getAgentCount()", `${agentCount} agents registered`);

        if (agentCount === 0) {
            warn("AGENTS: On-chain", "No agents registered. Register agents first.");
        }
    } catch (err: any) {
        fail("CONTRACT: Connectivity", `Failed to connect: ${err.message}`);
    }

    // ── 4. On-Chain Agent State ──
    console.log("4. Checking on-chain agent state...");

    if (contracts) {
        const count = await contracts.getAgentCount();
        const myAddress = contracts.walletAddress.toLowerCase();
        let ownedCount = 0;

        for (let i = 1; i <= Math.min(count, 20); i++) {
            try {
                const agent = await contracts.getAgent(i);
                const owned = agent.owner.toLowerCase() === myAddress;
                if (owned) ownedCount++;

                const accuracy =
                    Number(agent.totalPredictions) > 0
                        ? ((Number(agent.correctPredictions) / Number(agent.totalPredictions)) * 100).toFixed(1)
                        : "N/A";

                pass(
                    `AGENT #${i}: ${agent.name}`,
                    `active=${agent.active} credScore=${agent.credScore} accuracy=${accuracy}% predictions=${agent.totalPredictions} owned=${owned}`,
                );
            } catch {
                warn(`AGENT #${i}`, "Could not read agent data");
            }
        }

        if (ownedCount > 0) {
            pass("AGENTS: Deployer-owned", `${ownedCount} agents owned by deployer wallet`);
        } else {
            fail("AGENTS: Deployer-owned", "No deployer-owned agents found. Orchestrator cannot operate.");
        }
    }

    // ── 5. HOL Registration State ──
    console.log("5. Checking HOL registration state...");

    const cacheDir = process.env.HOL_STATE_DIR || path.resolve(process.cwd(), ".cache");
    const holNames = ["sentinel", "pulse", "meridian", "oracle"];

    for (const name of holNames) {
        const fp = path.join(cacheDir, `hol_${name}_state.json`);
        if (fs.existsSync(fp)) {
            try {
                const state = JSON.parse(fs.readFileSync(fp, "utf-8"));
                if (state.accountId && state.inboundTopicId) {
                    pass(
                        `HOL: ${name}`,
                        `account=${state.accountId} inbound=${state.inboundTopicId}`,
                    );
                } else {
                    warn(`HOL: ${name}`, "State file exists but missing accountId or inboundTopicId");
                }
            } catch {
                warn(`HOL: ${name}`, "State file exists but could not be parsed");
            }
        } else {
            warn(`HOL: ${name}`, `Not registered — run 'npm run register:hol' or register via frontend`);
        }
    }

    // ── 6. HCS Topic Configuration ──
    console.log("6. Checking HCS topic configuration...");

    const topicVars = [
        "ASCEND_PREDICTIONS_TOPIC_ID",
        "ASCEND_RESULTS_TOPIC_ID",
    ];

    for (const v of topicVars) {
        if (process.env[v]) {
            pass(`HCS: ${v}`, process.env[v]!);
        } else {
            fail(`HCS: ${v}`, "MISSING — run setup-hedera.ts first");
        }
    }

    const discourseTopics = [
        "ASCEND_DISCOURSE_SENTINEL_TOPIC_ID",
        "ASCEND_DISCOURSE_PULSE_TOPIC_ID",
        "ASCEND_DISCOURSE_MERIDIAN_TOPIC_ID",
        "ASCEND_DISCOURSE_ORACLE_TOPIC_ID",
    ];

    for (const v of discourseTopics) {
        if (process.env[v]) {
            pass(`HCS: ${v}`, process.env[v]!);
        } else {
            warn(`HCS: ${v}`, "Missing — discourse feed may be incomplete");
        }
    }

    // ── 7. HTS Token Configuration ──
    console.log("7. Checking HTS token configuration...");

    if (process.env.ASCEND_TOKEN_ID) {
        pass("HTS: ASCEND_TOKEN_ID", process.env.ASCEND_TOKEN_ID);
    } else {
        warn("HTS: ASCEND_TOKEN_ID", "Missing — HTS rewards disabled");
    }

    // ── 8. Round Execution Capability ──
    console.log("8. Checking round execution capability...");

    if (contracts) {
        try {
            const roundCount = await contracts.getRoundCount();
            pass("ROUNDS: Total executed", `${roundCount} rounds`);

            if (roundCount > 0) {
                const latestRound = await contracts.getRound(roundCount);
                const statusMap = ["Committing", "Revealing", "Resolved", "Cancelled"];
                pass(
                    `ROUNDS: Latest (#${roundCount})`,
                    `status=${statusMap[Number(latestRound.status)] || latestRound.status} participants=${latestRound.participantCount}`,
                );
            }
        } catch (err: any) {
            warn("ROUNDS: PredictionMarket", `Could not query rounds: ${err.message}`);
        }

        try {
            const tvl = await contracts.getTotalTVL();
            pass("STAKING: TVL", `${tvl} HBAR`);
        } catch (err: any) {
            warn("STAKING: TVL", `Could not query TVL: ${err.message}`);
        }
    }

    // ── Print Summary ──
    console.log();
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  VERIFICATION SUMMARY                           ║");
    console.log("╠══════════════════════════════════════════════════╣");

    const passCount = results.filter((r) => r.status === "PASS").length;
    const failCount = results.filter((r) => r.status === "FAIL").length;
    const warnCount = results.filter((r) => r.status === "WARN").length;

    for (const r of results) {
        const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⚠️";
        console.log(`║  ${icon} ${r.name}`);
        console.log(`║     ${r.detail}`);
    }

    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║  ✅ PASS: ${passCount}  ❌ FAIL: ${failCount}  ⚠️ WARN: ${warnCount}`);

    if (failCount === 0) {
        console.log("║                                                  ║");
        console.log("║  🎉 ASCEND IS READY FOR DEMO AND SUBMISSION     ║");
    } else {
        console.log("║                                                  ║");
        console.log("║  ⚠️  FIX FAILURES BEFORE SUBMISSION             ║");
    }

    console.log("╚══════════════════════════════════════════════════╝");

    if (failCount > 0) process.exit(1);
}

main().catch((error) => {
    console.error("Verification failed:", error);
    process.exit(1);
});
