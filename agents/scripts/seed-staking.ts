/**
 * Ascend — Seed Staking Liquidity
 *
 * Seeds the StakingVault with demo liquidity from the deployer wallet
 * so the UI shows a real market with capital backing each agent.
 *
 * Usage: npx tsx scripts/seed-staking.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { createContractClient } from "../src/core/contract-client.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const STAKES: Array<{ agentId: number; amountHbar: number }> = [
    { agentId: 1, amountHbar: 500 },   // Sentinel
    { agentId: 2, amountHbar: 300 },   // Pulse
    { agentId: 3, amountHbar: 200 },   // Meridian
    { agentId: 4, amountHbar: 100 },   // Oracle
];

async function main() {
    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Seed Staking Liquidity");
    console.log("═══════════════════════════════════════════\n");

    const contracts = createContractClient();

    // Check current TVL first
    const currentTVL = await contracts.getTotalTVL();
    console.log(`Current TVL: ${currentTVL} HBAR\n`);

    if (Number(currentTVL) > 100) {
        console.log("TVL already seeded. Skipping.\n");
        // Show per-agent breakdown
        for (const { agentId } of STAKES) {
            const agent = await contracts.getAgent(agentId);
            const staked = await contracts.getTotalStakedOnAgent(agentId);
            console.log(`  Agent #${agentId} (${agent.name}): ${staked} HBAR staked`);
        }
        return;
    }

    for (const { agentId, amountHbar } of STAKES) {
        try {
            const agent = await contracts.getAgent(agentId);
            console.log(`Staking ${amountHbar} HBAR on Agent #${agentId} (${agent.name})...`);
            await contracts.stake(agentId, amountHbar);
            console.log(`  Done. Staked ${amountHbar} HBAR on ${agent.name}`);
        } catch (err: any) {
            console.error(`  Failed to stake on Agent #${agentId}: ${err.message}`);
        }
    }

    // Verify
    console.log("\n--- Verification ---");
    const newTVL = await contracts.getTotalTVL();
    console.log(`New TVL: ${newTVL} HBAR`);

    for (const { agentId } of STAKES) {
        const agent = await contracts.getAgent(agentId);
        const staked = await contracts.getTotalStakedOnAgent(agentId);
        console.log(`  Agent #${agentId} (${agent.name}): ${staked} HBAR staked`);
    }

    console.log("\nStaking liquidity seeded successfully!");
}

main().catch((error) => {
    console.error("Seed staking failed:", error);
    process.exit(1);
});
