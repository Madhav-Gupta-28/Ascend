import * as dotenv from "dotenv";
import { AgentSentinel } from "../src/core/AgentSentinel.js";
import { AgentPulse } from "../src/core/AgentPulse.js";
import { AgentMeridian } from "../src/core/AgentMeridian.js";
import { AgentOracle } from "../src/core/AgentOracle.js";

dotenv.config();

async function main() {
    console.log("🚀 Starting Ascend AI Agents...");

    // In production, each agent would run on its own server/process with its own key.
    // For the hackathon demo, we run them in the same Node process as independent async loops.

    const defaultPrivateKey = process.env.HEDERA_OPERATOR_KEY;
    const defaultAccountId = process.env.HEDERA_OPERATOR_ID;
    if (!defaultPrivateKey) throw new Error("Missing HEDERA_OPERATOR_KEY");
    if (!defaultAccountId) throw new Error("Missing HEDERA_OPERATOR_ID");

    const sentinel = new AgentSentinel(
        process.env.SENTINEL_PRIVATE_KEY || defaultPrivateKey,
        process.env.SENTINEL_ACCOUNT_ID || defaultAccountId,
    );
    const pulse = new AgentPulse(
        process.env.PULSE_PRIVATE_KEY || defaultPrivateKey,
        process.env.PULSE_ACCOUNT_ID || defaultAccountId,
    );
    const meridian = new AgentMeridian(
        process.env.MERIDIAN_PRIVATE_KEY || defaultPrivateKey,
        process.env.MERIDIAN_ACCOUNT_ID || defaultAccountId,
    );
    const oracle = new AgentOracle(
        process.env.ORACLE_PRIVATE_KEY || defaultPrivateKey,
        process.env.ORACLE_ACCOUNT_ID || defaultAccountId,
    );

    console.log("-----------------------------------------");
    console.log(`🤖 Agent 1: ${sentinel["config"].name}`);
    console.log(`🤖 Agent 2: ${pulse["config"].name}`);
    console.log(`🤖 Agent 3: ${meridian["config"].name}`);
    console.log(`🤖 Agent 4: ${oracle["config"].name}`);
    console.log("-----------------------------------------");

    // Start their independent execution loops
    sentinel.start();
    pulse.start();
    meridian.start();
    oracle.start();

    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\nGracefully shutting down agents...");
        sentinel.stop();
        pulse.stop();
        meridian.stop();
        oracle.stop();
        process.exit(0);
    });
}

main().catch(console.error);
