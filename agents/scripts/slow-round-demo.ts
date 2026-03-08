/**
 * Create one round with LONG phases so you can watch commit → reveal on the frontend.
 *
 * Phases: Commit 5 min, Reveal 3 min. Commits are sent one-by-one with ~30s gaps
 * so you see each agent commit in real time. Same for reveals.
 *
 * Run: cd agents && npx tsx scripts/slow-round-demo.ts
 *
 * Then open the app → Live Round (round #N) and Intelligence Timeline.
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { createContractClient, ContractClient } from "../src/core/contract-client.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const AGENT_IDS = [1, 2, 3, 4];

// Long phases so you can watch in the UI
const COMMIT_SECS = 5 * 60;   // 5 minutes
const REVEAL_SECS = 3 * 60;   // 3 minutes
const ROUND_SECS = 10 * 60;   // 10 minutes
const GAP_BETWEEN_ACTIONS_MS = 28_000; // ~28s between each commit/reveal so you see them one by one

const START_PRICE_8 = 9_420_000;
const END_PRICE_8 = 9_500_000; // UP
const ENTRY_FEE_HBAR = 0;

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function formatCountdown(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

async function main() {
    const client = createContractClient();
    const startPrice = BigInt(START_PRICE_8);
    const endPrice = BigInt(END_PRICE_8);

    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  ASCEND — Slow round demo (watch commit/reveal on frontend)");
    console.log("══════════════════════════════════════════════════════════════\n");

    const count = await client.getAgentCount();
    if (count < 4) {
        console.log("Need at least 4 agents. Run: npm run seed (once) first.\n");
        process.exit(1);
    }

    console.log("Creating round with long phases:");
    console.log(`  Commit phase: ${COMMIT_SECS}s (${COMMIT_SECS / 60} min)`);
    console.log(`  Reveal phase: ${REVEAL_SECS}s (${REVEAL_SECS / 60} min)`);
    console.log(`  Round length: ${ROUND_SECS}s\n`);

    await client.createRound(COMMIT_SECS, REVEAL_SECS, ROUND_SECS, startPrice, ENTRY_FEE_HBAR);
    await sleep(5000);

    const roundCount = await client.getRoundCount();
    const roundId = roundCount;
    const round = await client.getRound(roundId);

    console.log("──────────────────────────────────────────────────────────────");
    console.log(`  ROUND #${roundId} CREATED`);
    console.log("──────────────────────────────────────────────────────────────");
    console.log("\n  Open the app → Live Round → Round #" + roundId);
    console.log("  Keep the Intelligence Timeline and Live Round page open.\n");
    console.log("  Committing one agent every ~30s so you see each commit appear.\n");

    const salts: string[] = [];
    const directions: number[] = [];
    const confidences: number[] = [];

    for (let i = 0; i < AGENT_IDS.length; i++) {
        const agentId = AGENT_IDS[i];
        const direction = agentId % 2;
        const confidence = 50 + agentId * 10;
        const salt = ContractClient.generateSalt();
        salts.push(salt);
        directions.push(direction);
        confidences.push(confidence);
        const hash = ContractClient.computeCommitHash(direction, confidence, salt);

        try {
            await client.commitPrediction(roundId, agentId, hash, ENTRY_FEE_HBAR);
            console.log(`  [${new Date().toLocaleTimeString()}] Agent ${agentId} committed → refresh or watch Live Round`);
        } catch (e: any) {
            console.log(`  [${new Date().toLocaleTimeString()}] Agent ${agentId} commit failed: ${e?.message ?? e}`);
        }
        if (i < AGENT_IDS.length - 1) {
            await sleep(GAP_BETWEEN_ACTIONS_MS);
        }
    }

    const commitDeadline = Number(round.commitDeadline);
    const now = Math.floor(Date.now() / 1000);
    let waitCommit = commitDeadline - now + 5;
    if (waitCommit < 0) waitCommit = 0;

    console.log("\n  All commits sent. Waiting for commit phase to end (" + formatCountdown(waitCommit) + ")…");
    await sleep(waitCommit * 1000);

    console.log("\n  Revealing one agent every ~30s…\n");

    for (let i = 0; i < AGENT_IDS.length; i++) {
        const agentId = AGENT_IDS[i];
        try {
            await client.revealPrediction(roundId, agentId, directions[i], confidences[i], salts[i]);
            console.log(`  [${new Date().toLocaleTimeString()}] Agent ${agentId} revealed → check Live Round & Timeline`);
        } catch (e: any) {
            console.log(`  [${new Date().toLocaleTimeString()}] Agent ${agentId} reveal failed: ${e?.message ?? e}`);
        }
        if (i < AGENT_IDS.length - 1) {
            await sleep(GAP_BETWEEN_ACTIONS_MS);
        }
    }

    const revealDeadline = Number(round.revealDeadline);
    let waitReveal = revealDeadline - Math.floor(Date.now() / 1000) + 5;
    if (waitReveal < 0) waitReveal = 0;

    console.log("\n  All reveals sent. Waiting until resolve time…");
    const resolveAfter = Number(round.resolveAfter);
    let waitResolve = resolveAfter - Math.floor(Date.now() / 1000) + 5;
    if (waitResolve < 0) waitResolve = 0;
    if (waitResolve > 0) {
        console.log("  (resolveAfter is " + formatCountdown(waitResolve) + " from now)");
        await sleep(waitResolve * 1000);
    }

    console.log("\n  Resolving round…");
    try {
        await client.resolveRound(roundId, endPrice);
        console.log("  Round resolved (outcome UP).");
    } catch (e: any) {
        console.log("  Resolve failed:", e?.message ?? e);
    }

    await sleep(2000);
    console.log("\n  Claiming results…");
    for (const agentId of AGENT_IDS) {
        try {
            await client.claimResult(roundId, agentId);
            console.log(`  Agent ${agentId} claimed`);
        } catch (e: any) {
            console.log(`  Agent ${agentId} claim: ${e?.message ?? e}`);
        }
        await sleep(1500);
    }

    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  Done. Refresh the app to see the full round and leaderboard.");
    console.log("══════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
