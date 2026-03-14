/**
 * Ascend — Bootstrap Demo
 *
 * Registers agents + seeds staking on the currently deployed contracts.
 * Usage: npx tsx scripts/bootstrap-demo.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { createContractClient } from "../src/core/contract-client.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const AGENTS = [
    { name: "Sentinel", description: "Technical analysis agent using momentum indicators and price action patterns to predict HBAR movement." },
    { name: "Pulse", description: "Sentiment analysis agent monitoring social signals and volume to gauge market mood and predict HBAR direction." },
    { name: "Meridian", description: "Mean reversion agent detecting price deviations from equilibrium to predict HBAR corrections." },
    { name: "Oracle", description: "Meta-AI agent combining multiple data streams and ensemble methods for HBAR price prediction." },
];

const STAKES = [
    { agentId: 1, amountHbar: 500 },   // Sentinel
    { agentId: 2, amountHbar: 50 },    // Pulse
    { agentId: 3, amountHbar: 30 },    // Meridian
    { agentId: 4, amountHbar: 20 },    // Oracle
];

async function main() {
    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Bootstrap Demo");
    console.log("═══════════════════════════════════════════\n");

    const contracts = createContractClient();

    // Step 1: Check existing agents
    const existingCount = await contracts.getAgentCount();
    console.log(`Current agent count: ${existingCount}\n`);

    // Step 2: Register agents if needed
    if (existingCount === 0) {
        console.log("--- Registering agents ---");
        for (const agent of AGENTS) {
            try {
                console.log(`  Registering ${agent.name}...`);
                const agentId = await contracts.registerAgent(agent.name, agent.description, 10);
                console.log(`  ✅ ${agent.name} registered as Agent #${agentId}`);
            } catch (err: any) {
                if (err.message?.includes("Already registered")) {
                    console.log(`  ⚠️ ${agent.name} already registered`);
                } else {
                    console.error(`  ❌ ${agent.name} registration failed: ${err.message}`);
                }
            }
        }
        console.log();
    } else {
        console.log("Agents already registered. Skipping registration.\n");
    }

    // Step 3: Verify agents exist
    const newCount = await contracts.getAgentCount();
    console.log(`Agent count after registration: ${newCount}`);
    for (let i = 1; i <= Math.min(newCount, 6); i++) {
        const a = await contracts.getAgent(i);
        console.log(`  #${i}: ${a.name} (active=${a.active} credScore=${a.credScore})`);
    }

    // Step 4: Seed staking
    console.log("\n--- Seeding staking liquidity ---");
    const currentTVL = await contracts.getTotalTVL();
    console.log(`Current TVL: ${currentTVL} HBAR`);

    if (Number(currentTVL) > 550) {
        console.log("TVL already seeded. Skipping.\n");
    } else {
        for (const { agentId, amountHbar } of STAKES) {
            if (agentId > newCount) {
                console.log(`  Skipping Agent #${agentId} (does not exist)`);
                continue;
            }
            try {
                const agent = await contracts.getAgent(agentId);
                console.log(`  Staking ${amountHbar} HBAR on ${agent.name}...`);
                await contracts.stake(agentId, amountHbar);
                console.log(`  ✅ Staked ${amountHbar} HBAR on ${agent.name}`);
            } catch (err: any) {
                console.error(`  ❌ Stake failed for Agent #${agentId}: ${err.message?.slice(0, 150)}`);
            }
        }
    }

    // Step 5: Final verification
    console.log("\n--- Final Verification ---");
    const finalTVL = await contracts.getTotalTVL();
    console.log(`TVL: ${finalTVL} HBAR`);
    for (let i = 1; i <= Math.min(newCount, 6); i++) {
        const a = await contracts.getAgent(i);
        const staked = await contracts.getTotalStakedOnAgent(i);
        console.log(`  #${i}: ${a.name} — staked: ${staked} HBAR`);
    }

    console.log("\n✅ Bootstrap complete!");
}

main().catch((error) => {
    console.error("Bootstrap failed:", error);
    process.exit(1);
});
