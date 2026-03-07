import * as dotenv from "dotenv";
import * as path from "path";

import {
    createHederaAgentKitFromEnv,
    loadDeployments,
} from "../src/core/index.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

async function main() {
    const kit = createHederaAgentKitFromEnv();

    try {
        console.log("═══════════════════════════════════════════");
        console.log("  ASCEND — Hedera Agent Kit Smoke Test");
        console.log("═══════════════════════════════════════════");

        const methods = kit.getEnabledMethods();
        console.log(`Enabled methods (${methods.length}):`);
        methods.forEach((method) => console.log(`  - ${method}`));

        const balance = await kit.getHbarBalance();
        console.log(`\nOperator balance:`);
        console.log(`  ${balance.humanMessage || JSON.stringify(balance.raw)}`);

        const deployments = loadDeployments();
        const predictionsTopicId =
            deployments.hcs.ascendPredictionsTopicId || deployments.hcs.ascendRoundsTopicId;

        if (predictionsTopicId) {
            const messages = await kit.getTopicMessages(predictionsTopicId, 5);
            console.log(`\nTopic read (${predictionsTopicId}):`);
            console.log(`  ${messages.humanMessage || "OK"}`);
        } else {
            console.log("\nNo predictions topic found in deployments; skipping topic query.");
        }

        console.log("═══════════════════════════════════════════");
        console.log("  ✅ Hedera Agent Kit test passed");
        console.log("═══════════════════════════════════════════");
    } finally {
        kit.close();
    }
}

main().catch((error) => {
    console.error("❌ Hedera Agent Kit test failed");
    console.error(error);
    process.exit(1);
});
