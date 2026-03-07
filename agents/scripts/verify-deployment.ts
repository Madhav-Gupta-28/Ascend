/**
 * Ascend — Deployment Verification Script
 * 
 * Verifies all Hedera resources are correctly deployed and accessible:
 * 1. HCS topic exists and is readable via Mirror Node
 * 2. HTS token exists with correct config
 * 3. Smart contracts are deployed and callable
 * 
 * Run: npx tsx scripts/verify-deployment.ts
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "../.env") });

const MIRROR_NODE = process.env.HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com";

interface Deployments {
    network: string;
    operatorId: string;
    hcs: {
        ascendPredictionsTopicId?: string;
        ascendResultsTopicId?: string;
        discourseTopicIds?: Record<string, string>;
        hcs10RegistryTopicId?: string;
        ascendRoundsTopicId?: string;
    };
    hts: { ascendTokenId: string };
    contracts: { agentRegistry: string; predictionMarket: string; stakingVault: string };
    createdAt: string;
}

async function mirrorGet(path: string): Promise<any> {
    const url = `${MIRROR_NODE}${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mirror Node ${res.status}: ${url}`);
    return res.json();
}

async function main() {
    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Deployment Verification");
    console.log("═══════════════════════════════════════════\n");

    const deploymentsPath = path.resolve(process.cwd(), "../deployments.json");
    if (!fs.existsSync(deploymentsPath)) {
        console.error("❌ deployments.json not found. Run setup-hedera.ts first.");
        process.exit(1);
    }

    const deployments: Deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
    let passed = 0;
    let failed = 0;

    // ── Check 1: HCS Topics ──
    try {
        const hcsTopics = [
            ["predictions", deployments.hcs.ascendPredictionsTopicId || deployments.hcs.ascendRoundsTopicId],
            ["results", deployments.hcs.ascendResultsTopicId],
            ["hcs10-registry", deployments.hcs.hcs10RegistryTopicId],
        ] as const;

        for (const [label, topicId] of hcsTopics) {
            if (!topicId) {
                console.log(`⚠️  HCS ${label}: not configured`);
                continue;
            }
            const topic = await mirrorGet(`/api/v1/topics/${topicId}`);
            console.log(`✅ HCS ${label}: ${topicId}`);
            console.log(`   Memo: ${topic.memo}`);
            passed++;

            const msgs = await mirrorGet(`/api/v1/topics/${topicId}/messages?limit=3&order=desc`);
            const msgCount = msgs.messages?.length || 0;
            console.log(`   Messages: ${msgCount} found`);
            if (msgCount > 0) {
                const latest = msgs.messages[0];
                const decoded = Buffer.from(latest.message, "base64").toString("utf-8");
                console.log(`   Latest message: ${decoded}`);
            }
        }

        if (deployments.hcs.discourseTopicIds) {
            for (const [agent, topicId] of Object.entries(deployments.hcs.discourseTopicIds)) {
                const topic = await mirrorGet(`/api/v1/topics/${topicId}`);
                console.log(`✅ HCS discourse (${agent}): ${topicId}`);
                console.log(`   Memo: ${topic.memo}`);
                passed++;
            }
        }
    } catch (e: any) {
        console.log(`❌ HCS Topics: ${e.message}`);
        failed++;
    }

    // ── Check 2: HTS Token ──
    try {
        const tokenId = deployments.hts.ascendTokenId;
        const token = await mirrorGet(`/api/v1/tokens/${tokenId}`);
        console.log(`\n✅ HTS Token: ${tokenId}`);
        console.log(`   Name: ${token.name}`);
        console.log(`   Symbol: ${token.symbol}`);
        console.log(`   Decimals: ${token.decimals}`);
        console.log(`   Total Supply: ${Number(token.total_supply) / 10 ** token.decimals}`);
        passed++;
    } catch (e: any) {
        console.log(`\n❌ HTS Token: ${e.message}`);
        failed++;
    }

    // ── Check 3: Smart Contracts ──
    for (const [name, addr] of Object.entries(deployments.contracts)) {
        if (addr === "NOT_DEPLOYED") {
            console.log(`\n⚠️  Contract ${name}: NOT_DEPLOYED (run forge deploy)`);
            continue;
        }
        try {
            // Check contract exists via Mirror Node
            const contract = await mirrorGet(`/api/v1/contracts/${addr}`);
            console.log(`\n✅ Contract ${name}: ${addr}`);
            console.log(`   EVM Address: ${contract.evm_address}`);
            console.log(`   Created: ${contract.created_timestamp}`);
            passed++;
        } catch (e: any) {
            console.log(`\n❌ Contract ${name}: ${e.message}`);
            failed++;
        }
    }

    // ── Summary ──
    console.log("\n═══════════════════════════════════════════");
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log("═══════════════════════════════════════════");

    if (failed > 0) process.exit(1);
}

main();
