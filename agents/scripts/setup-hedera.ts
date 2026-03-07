/**
 * Ascend — Hedera Infrastructure Setup Script
 *
 * Creates all Hedera-native resources required for Ascend:
 * 1. HCS topic "ascend-predictions"
 * 2. HCS topic "ascend-results"
 * 3. HCS topics "ascend-discourse-{agent}" per agent
 * 4. HCS topic "hcs10-registry"
 * 5. HTS "ASCEND" fungible token
 * 6. Saves all resource IDs to deployments.json
 *
 * Run: npx tsx scripts/setup-hedera.ts
 */

import {
    Client,
    AccountId,
    PrivateKey,
    TopicCreateTransaction,
    TopicMessageSubmitTransaction,
    TokenCreateTransaction,
    TokenType,
    TokenSupplyType,
    Hbar,
    TopicId,
} from "@hashgraph/sdk";
import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "../.env") });

const OPERATOR_ID = process.env.HEDERA_OPERATOR_ID;
const OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY;
const NETWORK = process.env.HEDERA_NETWORK || "testnet";
const DISCOURSE_AGENTS = ["sentinel", "pulse", "meridian", "oracle"] as const;

if (!OPERATOR_ID || !OPERATOR_KEY) {
    console.error("❌ Missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY in .env");
    console.error("   Create a testnet account at https://portal.hedera.com");
    process.exit(1);
}

function createClient(): Client {
    const operatorId = AccountId.fromString(OPERATOR_ID!);
    const operatorKey = PrivateKey.fromStringED25519(OPERATOR_KEY!);

    let client: Client;
    if (NETWORK === "testnet") {
        client = Client.forTestnet();
    } else if (NETWORK === "mainnet") {
        client = Client.forMainnet();
    } else {
        throw new Error(`Unknown network: ${NETWORK}`);
    }

    client.setOperator(operatorId, operatorKey);
    client.setDefaultMaxTransactionFee(new Hbar(10));
    client.setDefaultMaxQueryPayment(new Hbar(5));

    return client;
}

async function createTopic(
    client: Client,
    memo: string,
    options: { submitRestricted?: boolean } = {},
): Promise<string> {
    const operatorKey = PrivateKey.fromStringED25519(OPERATOR_KEY!);
    const tx = new TopicCreateTransaction()
        .setTopicMemo(memo)
        .setAdminKey(operatorKey.publicKey)
        .setAutoRenewAccountId(AccountId.fromString(OPERATOR_ID!));

    if (options.submitRestricted ?? true) {
        tx.setSubmitKey(operatorKey.publicKey);
    }

    const response = await tx.execute(client);
    const receipt = await response.getReceipt(client);
    const topicId = receipt.topicId!.toString();

    return topicId;
}

async function sendTopicProbe(
    client: Client,
    topicId: string,
    payload: Record<string, unknown>,
): Promise<void> {
    const tx = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(JSON.stringify(payload));
    const response = await tx.execute(client);
    await response.getReceipt(client);
}

interface HcsTopicSet {
    ascendPredictionsTopicId: string;
    ascendResultsTopicId: string;
    discourseTopicIds: Record<string, string>;
    hcs10RegistryTopicId: string;
}

async function createHcsTopics(client: Client): Promise<HcsTopicSet> {
    console.log("\n📡 Creating HCS topics...");

    const ascendPredictionsTopicId = await createTopic(client, "ascend-predictions", {
        submitRestricted: true,
    });
    console.log(`   ✅ ascend-predictions: ${ascendPredictionsTopicId}`);

    const ascendResultsTopicId = await createTopic(client, "ascend-results", {
        submitRestricted: true,
    });
    console.log(`   ✅ ascend-results:     ${ascendResultsTopicId}`);

    const discourseTopicIds: Record<string, string> = {};
    for (const agent of DISCOURSE_AGENTS) {
        const topicId = await createTopic(client, `ascend-discourse-${agent}`, {
            submitRestricted: false,
        });
        discourseTopicIds[agent] = topicId;
        console.log(`   ✅ ascend-discourse-${agent}: ${topicId}`);
    }

    const hcs10RegistryTopicId = await createTopic(client, "hcs10-registry", {
        submitRestricted: false,
    });
    console.log(`   ✅ hcs10-registry:     ${hcs10RegistryTopicId}`);

    await sendTopicProbe(client, ascendPredictionsTopicId, {
        type: "SYSTEM",
        message: "Ascend predictions topic initialized",
        createdAt: new Date().toISOString(),
    });
    await sendTopicProbe(client, ascendResultsTopicId, {
        type: "SYSTEM",
        message: "Ascend results topic initialized",
        createdAt: new Date().toISOString(),
    });

    return {
        ascendPredictionsTopicId,
        ascendResultsTopicId,
        discourseTopicIds,
        hcs10RegistryTopicId,
    };
}

async function createHTSToken(client: Client): Promise<string> {
    console.log("\n🪙  Creating HTS token: ASCEND...");

    const operatorKey = PrivateKey.fromStringED25519(OPERATOR_KEY!);
    const operatorId = AccountId.fromString(OPERATOR_ID!);

    const tx = new TokenCreateTransaction()
        .setTokenName("Ascend Intelligence Token")
        .setTokenSymbol("ASCEND")
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(1_000_000_00000000)
        .setInitialSupply(1_000_000_00000000)
        .setDecimals(8)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(operatorKey.publicKey)
        .setSupplyKey(operatorKey.publicKey)
        .setAutoRenewAccountId(operatorId);

    const response = await tx.execute(client);
    const receipt = await response.getReceipt(client);
    const tokenId = receipt.tokenId!.toString();

    console.log(`   ✅ Token created: ${tokenId}`);
    console.log("      Name:    Ascend Intelligence Token");
    console.log("      Symbol:  ASCEND");
    console.log("      Supply:  1,000,000 (8 decimals)");

    return tokenId;
}

interface Deployments {
    network: string;
    operatorId: string;
    hcs: {
        ascendPredictionsTopicId: string;
        ascendResultsTopicId: string;
        discourseTopicIds: Record<string, string>;
        hcs10RegistryTopicId: string;
        ascendRoundsTopicId?: string;
    };
    hts: {
        ascendTokenId: string;
    };
    contracts: {
        agentRegistry: string;
        predictionMarket: string;
        stakingVault: string;
    };
    createdAt: string;
}

function saveDeployments(hcsTopics: HcsTopicSet, tokenId: string): void {
    const deploymentsPath = path.resolve(process.cwd(), "../deployments.json");

    let existing: Partial<Deployments> = {};
    if (fs.existsSync(deploymentsPath)) {
        existing = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
    }

    const deployments: Deployments = {
        network: NETWORK,
        operatorId: OPERATOR_ID!,
        hcs: {
            ascendPredictionsTopicId: hcsTopics.ascendPredictionsTopicId,
            ascendResultsTopicId: hcsTopics.ascendResultsTopicId,
            discourseTopicIds: hcsTopics.discourseTopicIds,
            hcs10RegistryTopicId: hcsTopics.hcs10RegistryTopicId,
            // Legacy alias retained for backward compatibility
            ascendRoundsTopicId: hcsTopics.ascendPredictionsTopicId,
        },
        hts: {
            ascendTokenId: tokenId,
        },
        contracts: {
            agentRegistry: existing.contracts?.agentRegistry || "NOT_DEPLOYED",
            predictionMarket: existing.contracts?.predictionMarket || "NOT_DEPLOYED",
            stakingVault: existing.contracts?.stakingVault || "NOT_DEPLOYED",
        },
        createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
    console.log(`\n📄 Deployments saved to ${deploymentsPath}`);
}

function generateEnvExample(): void {
    const envExamplePath = path.resolve(process.cwd(), "../.env.example");

    const content = `# Hedera Testnet Configuration
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=0.0.XXXXX
HEDERA_OPERATOR_KEY=302e020100...
HEDERA_JSON_RPC=https://testnet.hashio.io/api
HEDERA_MIRROR_NODE=https://testnet.mirrornode.hedera.com
NEXT_PUBLIC_HEDERA_NETWORK=testnet
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=wc_project_id_here

# Deployer private key (ECDSA hex for Foundry)
DEPLOYER_PRIVATE_KEY=0x...

# Contract Addresses (populated after forge deploy)
AGENT_REGISTRY_ADDRESS=0x...
PREDICTION_MARKET_ADDRESS=0x...
STAKING_VAULT_ADDRESS=0x...

# HCS Topics (populated after setup-hedera.ts)
ASCEND_PREDICTIONS_TOPIC_ID=0.0.XXXXX
ASCEND_RESULTS_TOPIC_ID=0.0.XXXXX
ASCEND_DISCOURSE_SENTINEL_TOPIC_ID=0.0.XXXXX
ASCEND_DISCOURSE_PULSE_TOPIC_ID=0.0.XXXXX
ASCEND_DISCOURSE_MERIDIAN_TOPIC_ID=0.0.XXXXX
ASCEND_DISCOURSE_ORACLE_TOPIC_ID=0.0.XXXXX
ASCEND_DISCOURSE_TOPICS_JSON={"sentinel":"0.0.XXXXX","pulse":"0.0.YYYYY","meridian":"0.0.ZZZZZ","oracle":"0.0.AAAAA"}
HCS10_REGISTRY_TOPIC_ID=0.0.XXXXX

# Legacy fallback (kept for backward compatibility)
ASCEND_ROUNDS_TOPIC_ID=0.0.XXXXX

# Optional per-agent HCS-10 identities
SENTINEL_ACCOUNT_ID=0.0.XXXXX
SENTINEL_PRIVATE_KEY=302e020100...
PULSE_ACCOUNT_ID=0.0.XXXXX
PULSE_PRIVATE_KEY=302e020100...
MERIDIAN_ACCOUNT_ID=0.0.XXXXX
MERIDIAN_PRIVATE_KEY=302e020100...
ORACLE_ACCOUNT_ID=0.0.XXXXX
ORACLE_PRIVATE_KEY=302e020100...

# Optional: Explicit HCS-10 keys/topics per agent
SENTINEL_HCS10_ACCOUNT_ID=0.0.XXXXX
SENTINEL_HCS10_PRIVATE_KEY=302e020100...
SENTINEL_HCS10_INBOUND_TOPIC_ID=0.0.XXXXX
SENTINEL_HCS10_OUTBOUND_TOPIC_ID=0.0.XXXXX
PULSE_HCS10_ACCOUNT_ID=0.0.XXXXX
PULSE_HCS10_PRIVATE_KEY=302e020100...
PULSE_HCS10_INBOUND_TOPIC_ID=0.0.XXXXX
PULSE_HCS10_OUTBOUND_TOPIC_ID=0.0.XXXXX
MERIDIAN_HCS10_ACCOUNT_ID=0.0.XXXXX
MERIDIAN_HCS10_PRIVATE_KEY=302e020100...
MERIDIAN_HCS10_INBOUND_TOPIC_ID=0.0.XXXXX
MERIDIAN_HCS10_OUTBOUND_TOPIC_ID=0.0.XXXXX
ORACLE_HCS10_ACCOUNT_ID=0.0.XXXXX
ORACLE_HCS10_PRIVATE_KEY=302e020100...
ORACLE_HCS10_INBOUND_TOPIC_ID=0.0.XXXXX
ORACLE_HCS10_OUTBOUND_TOPIC_ID=0.0.XXXXX

# Optional: Web relay identity and manual routing for discourse question.ask
WEB_HCS10_OPERATOR_ID=0.0.XXXXX@0.0.XXXXX
WEB_HCS10_INBOUND_TOPIC_ID=0.0.XXXXX
HCS10_CONNECTION_TOPICS_JSON={"1":"0.0.XXXXX","4":"0.0.YYYYY"}

# HTS Token (populated after setup-hedera.ts)
ASCEND_TOKEN_ID=0.0.XXXXX

# Orchestrator runtime (continuous rounds)
ORCHESTRATOR_COMMIT_SECS=180
ORCHESTRATOR_REVEAL_SECS=60
ORCHESTRATOR_ROUND_SECS=300
ORCHESTRATOR_ENTRY_FEE_HBAR=1
ORCHESTRATOR_COOLDOWN_SECS=15

# Optional HTS rewards in orchestrator
HTS_REWARDS_ENABLED=false
HTS_REWARD_PER_WINNER_TOKENS=10

# E2E single-round test config
E2E_COMMIT_SECS=60
E2E_REVEAL_SECS=30
E2E_ROUND_SECS=120
E2E_ENTRY_FEE_HBAR=0.5
E2E_HTS_REWARDS_ENABLED=true
E2E_HTS_REWARD_PER_WINNER_TOKENS=1

# AI Agent Config
OPENAI_API_KEY=sk-...

# Price Data
COINGECKO_API_KEY=CG-...
`;

    fs.writeFileSync(envExamplePath, content);
    console.log(`📋 .env.example updated at ${envExamplePath}`);
}

async function main() {
    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Hedera Infrastructure Setup");
    console.log("═══════════════════════════════════════════");
    console.log(`  Network:  ${NETWORK}`);
    console.log(`  Operator: ${OPERATOR_ID}`);

    const client = createClient();

    try {
        const hcsTopics = await createHcsTopics(client);
        const tokenId = await createHTSToken(client);
        saveDeployments(hcsTopics, tokenId);
        generateEnvExample();

        console.log("\n═══════════════════════════════════════════");
        console.log("  ✅ Setup Complete!");
        console.log("═══════════════════════════════════════════");
        console.log(`  HCS Predictions:      ${hcsTopics.ascendPredictionsTopicId}`);
        console.log(`  HCS Results:          ${hcsTopics.ascendResultsTopicId}`);
        for (const agent of DISCOURSE_AGENTS) {
            console.log(`  HCS Discourse ${agent}: ${hcsTopics.discourseTopicIds[agent]}`);
        }
        console.log(`  HCS-10 Registry:      ${hcsTopics.hcs10RegistryTopicId}`);
        console.log(`  HTS Token:            ${tokenId}`);
        console.log("");
        console.log("  Next steps:");
        console.log("  1. Add DEPLOYER_PRIVATE_KEY (ECDSA hex) to .env");
        console.log("  2. Run: cd contracts && forge script script/DeployAscend.s.sol \\");
        console.log("          --rpc-url https://testnet.hashio.io/api --broadcast --legacy");
        console.log("  3. Update deployments.json with contract addresses");
        console.log("═══════════════════════════════════════════");
    } catch (error) {
        console.error("\n❌ Setup failed:", error);
        process.exit(1);
    } finally {
        client.close();
    }
}

main();
