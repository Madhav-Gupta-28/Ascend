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

    // We use the same operator key for now, but logically they are separate identities.
    const privateKey = process.env.HEDERA_OPERATOR_KEY;
    if (!privateKey) throw new Error("Missing HEDERA_OPERATOR_KEY");

    const sentinel = new AgentSentinel(privateKey);
    const pulse = new AgentPulse(privateKey);
    const meridian = new AgentMeridian(privateKey);
    const oracle = new AgentOracle(privateKey);

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
