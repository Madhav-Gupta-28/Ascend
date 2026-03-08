/**
 * Seed Ascend with real on-chain data: register 4 agents, create one round,
 * commit/reveal/resolve/claim so the UI shows real leaderboard and round data.
 *
 * Run from repo root: cd agents && npx tsx scripts/seed-real-data.ts
 * Or: npm run seed (if script is added to package.json)
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { createContractClient, ContractClient } from "../src/core/contract-client.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const AGENTS = [
    { name: "Sentinel", description: "Technical Analysis" },
    { name: "Pulse", description: "Sentiment" },
    { name: "Meridian", description: "Mean Reversion" },
    { name: "Oracle", description: "Meta-AI" },
];

const BOND_HBAR = 10;
const COMMIT_SECS = 60;
const REVEAL_SECS = 30;
const ROUND_SECS = 120;
const START_PRICE_8 = 9_420_000; // 0.0942 * 1e8
const END_PRICE_8 = 9_500_000;   // 0.0950 * 1e8 (UP)
const ENTRY_FEE_HBAR = 0;

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    const client = createContractClient();
    const startPrice = BigInt(START_PRICE_8);
    const endPrice = BigInt(END_PRICE_8);

    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Seed real data (agents + round)");
    console.log("═══════════════════════════════════════════");

    let count = await client.getAgentCount();
    if (count < AGENTS.length) {
        console.log(`\n📋 Registering ${AGENTS.length - count} agents (bond ${BOND_HBAR} HBAR each)...`);
        for (let i = count; i < AGENTS.length; i++) {
            const a = AGENTS[i];
            try {
                await client.registerAgent(a.name, a.description, BOND_HBAR);
                console.log(`   ✅ ${a.name} (agentId ${i + 1})`);
            } catch (e: any) {
                console.log(`   ⚠️ ${a.name}: ${e?.message ?? e}`);
            }
            await sleep(3000);
        }
        count = await client.getAgentCount();
    }
    console.log(`   Agents on chain: ${count}`);

    let roundCount = await client.getRoundCount();
    let roundId: number;
    if (roundCount === 0) {
        console.log("\n📋 Creating round...");
        await client.createRound(COMMIT_SECS, REVEAL_SECS, ROUND_SECS, startPrice, ENTRY_FEE_HBAR);
        await sleep(5000);
        roundCount = await client.getRoundCount();
        roundId = roundCount;
        console.log(`   ✅ Round #${roundId} created`);
    } else {
        const latest = await client.getRound(roundCount);
        if (latest.status === 0 || latest.status === 1) {
            roundId = roundCount;
            console.log(`\n📋 Using existing active round #${roundId}`);
        } else {
            console.log("\n📋 Creating new round...");
            await client.createRound(COMMIT_SECS, REVEAL_SECS, ROUND_SECS, startPrice, ENTRY_FEE_HBAR);
            await sleep(5000);
            roundCount = await client.getRoundCount();
            roundId = roundCount;
            console.log(`   ✅ Round #${roundId} created`);
        }
    }

    const round = await client.getRound(roundId);
    if (round.status !== 0) {
        console.log(`\n   Round #${roundId} is not in commit phase (status=${round.status}). Skipping commit/reveal.`);
        console.log("   Frontend will show existing round and agent data.");
        return;
    }

    console.log("\n📋 Committing predictions for agents 1–4...");
    const salts: string[] = [];
    const directions: number[] = [];
    const confidences: number[] = [];
    for (let agentId = 1; agentId <= Math.min(4, count); agentId++) {
        const direction = agentId % 2; // 0=UP, 1=DOWN
        const confidence = 50 + agentId * 10;
        const salt = ContractClient.generateSalt();
        salts.push(salt);
        directions.push(direction);
        confidences.push(confidence);
        const hash = ContractClient.computeCommitHash(direction, confidence, salt);
        try {
            await client.commitPrediction(roundId, agentId, hash, ENTRY_FEE_HBAR);
            console.log(`   ✅ Agent ${agentId} committed`);
        } catch (e: any) {
            console.log(`   ⚠️ Agent ${agentId}: ${e?.message ?? e}`);
        }
        await sleep(2000);
    }

    console.log(`\n   Waiting ${COMMIT_SECS + 5}s for commit phase to end...`);
    await sleep((COMMIT_SECS + 5) * 1000);

    console.log("\n📋 Revealing predictions...");
    for (let agentId = 1; agentId <= Math.min(4, count); agentId++) {
        const i = agentId - 1;
        try {
            await client.revealPrediction(roundId, agentId, directions[i], confidences[i], salts[i]);
            console.log(`   ✅ Agent ${agentId} revealed`);
        } catch (e: any) {
            console.log(`   ⚠️ Agent ${agentId}: ${e?.message ?? e}`);
        }
        await sleep(2000);
    }

    const resolveAfter = Number(round.resolveAfter);
    const waitResolve = Math.max(0, resolveAfter - Math.floor(Date.now() / 1000) + 5);
    if (waitResolve > 0) {
        console.log(`\n   Waiting ${waitResolve}s until resolve time...`);
        await sleep(waitResolve * 1000);
    }

    console.log("\n📋 Resolving round...");
    try {
        await client.resolveRound(roundId, endPrice);
        console.log("   ✅ Round resolved (outcome UP)");
    } catch (e: any) {
        console.log(`   ⚠️ Resolve: ${e?.message ?? e}`);
    }
    await sleep(3000);

    console.log("\n📋 Claiming results for each agent...");
    for (let agentId = 1; agentId <= Math.min(4, count); agentId++) {
        try {
            await client.claimResult(roundId, agentId);
            console.log(`   ✅ Agent ${agentId} claimed`);
        } catch (e: any) {
            console.log(`   ⚠️ Agent ${agentId}: ${e?.message ?? e}`);
        }
        await sleep(2000);
    }

    console.log("\n═══════════════════════════════════════════");
    console.log("  Done. Refresh the app to see real data.");
    console.log("═══════════════════════════════════════════");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
