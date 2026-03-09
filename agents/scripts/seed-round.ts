/**
 * Ascend — Fast Round Seeder
 * 
 * Seeds the smart contracts with a COMPLETE round cycle using very short
 * timer windows so data populates instantly for the frontend demo.
 * 
 * This does: create round → commit → reveal → resolve → claimResult
 * in about 30 seconds total.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

import { createHCSPublisher } from "../src/core/hcs-publisher.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const RPC = process.env.HEDERA_JSON_RPC || "https://testnet.hashio.io/api";
const PK = process.env.DEPLOYER_PRIVATE_KEY!;

const REGISTRY_ADDR = process.env.AGENT_REGISTRY_ADDRESS!;
const MARKET_ADDR = process.env.PREDICTION_MARKET_ADDRESS!;
const hcs = createHCSPublisher();
const STAKING_ADDR = process.env.STAKING_VAULT_ADDRESS!;

const MARKET_JSON = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../contracts/out/PredictionMarket.sol/PredictionMarket.json"), "utf-8"));
const REGISTRY_JSON = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../contracts/out/AgentRegistry.sol/AgentRegistry.json"), "utf-8"));

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

const market = new ethers.Contract(MARKET_ADDR, MARKET_JSON.abi, wallet);
const registry = new ethers.Contract(REGISTRY_ADDR, REGISTRY_JSON.abi, wallet);

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function retry<T>(fn: () => Promise<T>, retries = 5, delayMs = 3000): Promise<T> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e: any) {
            const msg = e.message || "";
            if ((msg.includes("502") || msg.includes("SERVER_ERROR") || msg.includes("TIMEOUT")) && i < retries - 1) {
                console.log(`  ⏳ RPC error, retrying in ${delayMs / 1000}s... (${i + 1}/${retries})`);
                await sleep(delayMs);
                continue;
            }
            throw e;
        }
    }
    throw new Error("Max retries exceeded");
}

async function main() {
    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Fast Round Seeder");
    console.log("═══════════════════════════════════════════\n");

    // Check agents
    const agentCount = Number(await registry.getAgentCount());
    console.log(`Agents registered: ${agentCount}`);
    if (agentCount < 4) {
        console.error("Need at least 4 agents. Run setup first.");
        process.exit(1);
    }

    // Timers must accommodate Hashio's ~5-8s per tx + 2.5s buffer between them
    // 4 agents × ~8s each = ~32s minimum for commits
    const commitDuration = 45;
    const revealDuration = 15;
    const roundDuration = 75;
    const startPrice = 9420000n; // $0.0942
    const entryFee = 0n; // Free round for hackathon demo (avoids tinybar/weibar denomination issues)

    console.log(`Creating round (commit=${commitDuration}s, reveal=${revealDuration}s, round=${roundDuration}s)...`);

    const createTx = await retry(() => market.createRound(commitDuration, revealDuration, roundDuration, startPrice, entryFee));
    await createTx.wait();
    await sleep(3000);

    const roundCount = Number(await market.getRoundCount());
    const roundId = roundCount;
    console.log(`✅ Round #${roundId} created\n`);

    // Generate predictions for 4 agents
    const agentPredictions = [
        { agentId: 1, name: "Sentinel", direction: 1, confidence: 72, thought: "Sentinel detected RSI oversold signal and bearish volume divergence" },
        { agentId: 2, name: "Pulse", direction: 0, confidence: 65, thought: "Pulse detected positive sentiment spike across social channels" },
        { agentId: 3, name: "Meridian", direction: 0, confidence: 58, thought: "Meridian mean reversion model indicates upward correction likely" },
        { agentId: 4, name: "Oracle", direction: 1, confidence: 80, thought: "Oracle verified counter-trend behavior in historical analogies" },
    ];

    // Step 0.5: Broadcast "Thinking" events to make timeline alive
    console.log("🧠 Agents are thinking...");
    for (const pred of agentPredictions) {
        try {
            await hcs.publishThinking(roundId, pred.name, pred.thought);
            console.log(`  💭 ${pred.name} thinking: ${pred.thought}`);
            await sleep(1500); // Visual stagger for the timeline
        } catch (e: any) {
            console.error(`  ❌ ${pred.name} thinking publish failed:`, e.reason || e.message);
        }
    }

    // Step 1: Commit predictions
    console.log("🔒 Committing predictions...");
    const salts: string[] = [];
    for (const pred of agentPredictions) {
        const salt = ethers.hexlify(ethers.randomBytes(32));
        salts.push(salt);

        const commitHash = ethers.solidityPackedKeccak256(
            ["uint8", "uint256", "bytes32"],
            [pred.direction, pred.confidence, salt]
        );

        try {
            const tx = await retry(() => market.commitPrediction(roundId, pred.agentId, commitHash));
            await tx.wait();
            console.log(`  ✅ ${pred.name} committed (${pred.direction === 0 ? "UP" : "DOWN"} @ ${pred.confidence}%)`);
            await sleep(2500);
        } catch (e: any) {
            console.error(`  ❌ ${pred.name} commit failed:`, e.reason || e.message);
        }
    }

    // Step 2: Wait for commit phase to end
    console.log(`\n⏳ Waiting for commit phase to end...`);
    // We already spent some time committing & thinking. Just sleep enough to cross the 60s mark from creation.
    // Let's just sleep 15s which should safely put us into the reveal window without passing the reveal deadline.
    await sleep(15000);

    // Step 3: Reveal predictions
    console.log("\n🔓 Revealing predictions...");
    for (let i = 0; i < agentPredictions.length; i++) {
        const pred = agentPredictions[i];
        try {
            const tx = await retry(() => market.revealPrediction(roundId, pred.agentId, pred.direction, pred.confidence, salts[i]));
            await tx.wait();
            console.log(`  ✅ ${pred.name} revealed: ${pred.direction === 0 ? "UP" : "DOWN"} @ ${pred.confidence}%`);
            await sleep(2500);
        } catch (e: any) {
            console.error(`  ❌ ${pred.name} reveal failed:`, e.reason || e.message);
        }
    }

    // Step 4: Wait for round to be resolvable
    const resolveWait = Math.max(0, roundDuration - commitDuration - revealDuration);
    if (resolveWait > 0) {
        console.log(`\n⏳ Waiting ${resolveWait}s for round to be resolvable...`);
        await sleep((resolveWait + 2) * 1000);
    }
    await sleep(3000); // extra buffer

    // Step 5: Resolve round
    console.log("\n📊 Resolving round...");
    const endPrice = 9380000n; // $0.0938 — price went DOWN
    try {
        const tx = await retry(() => market.resolveRound(roundId, endPrice));
        await tx.wait();
        console.log(`  ✅ Round #${roundId} resolved (endPrice=$${Number(endPrice) / 1e8})`);
        console.log(`  Outcome: DOWN (price decreased)`);
    } catch (e: any) {
        console.error("  ❌ Resolve failed:", e.reason || e.message);
    }
    await sleep(3000);

    // Step 6: Claim results for each agent (this updates credScore!)
    console.log("\n🧮 Claiming results (updates credScore)...");
    for (const pred of agentPredictions) {
        try {
            const tx = await retry(() => market.claimResult(roundId, pred.agentId));
            await tx.wait();
            const isCorrect = pred.direction === 1; // DOWN is correct
            console.log(`  ${isCorrect ? "✅" : "❌"} ${pred.name}: ${isCorrect ? "CORRECT" : "WRONG"} → credScore ${isCorrect ? "+" : "-"}${pred.confidence}`);
            await sleep(2500);
        } catch (e: any) {
            console.error(`  ❌ ${pred.name} claim failed:`, e.reason || e.message);
        }
    }

    // Verify final state
    console.log("\n═══════════════════════════════════════════");
    console.log("  FINAL ON-CHAIN STATE");
    console.log("═══════════════════════════════════════════");
    for (let i = 1; i <= 4; i++) {
        const a = await registry.getAgent(i);
        console.log(`  ${a[1]}: preds=${a[3]} correct=${a[4]} credScore=${a[5]} active=${a[9]}`);
    }
    console.log("\nDone! Refresh your frontend to see real data.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
