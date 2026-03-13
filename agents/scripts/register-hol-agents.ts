/**
 * Ascend — Register All Agents in HOL Registry
 *
 * One-time script to register Sentinel, Pulse, Meridian, and Oracle
 * in the Hashgraph Online Guarded Registry using the official standards-sdk.
 *
 * Usage:
 *   npx tsx scripts/register-hol-agents.ts
 *
 * After registration, agent credentials are saved to .cache/hol_*_state.json
 * and can be loaded by BaseAgent at runtime.
 */

import "dotenv/config";
import { registerAllAgents } from "../src/core/hol-registry.js";

async function main() {
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  ASCEND — HOL Registry Agent Registration       ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log();

    const results = await registerAllAgents();

    console.log();
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  Registration Summary                           ║");
    console.log("╠══════════════════════════════════════════════════╣");

    for (const [name, state] of results) {
        console.log(`║  ${name.padEnd(12)} │ ${state.accountId.padEnd(16)} │ inbound: ${state.inboundTopicId}`);
    }

    if (results.size === 0) {
        console.log("║  No agents registered (all may already exist)  ║");
    }

    console.log("╚══════════════════════════════════════════════════╝");
    console.log();

    if (results.size > 0) {
        console.log("Add these to your .env file:");
        console.log();
        for (const [name, state] of results) {
            const prefix = name.toUpperCase();
            console.log(`${prefix}_HOL_ACCOUNT_ID=${state.accountId}`);
            console.log(`${prefix}_HOL_PRIVATE_KEY=${state.privateKey}`);
            console.log(`${prefix}_HOL_INBOUND_TOPIC_ID=${state.inboundTopicId}`);
            console.log(`${prefix}_HOL_OUTBOUND_TOPIC_ID=${state.outboundTopicId}`);
            console.log(`${prefix}_HOL_PROFILE_TOPIC_ID=${state.profileTopicId}`);
            console.log();
        }
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
