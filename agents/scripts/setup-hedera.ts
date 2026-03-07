/**
 * Ascend — Hedera Infrastructure Setup Script
 * 
 * Creates all Hedera-native resources required for Ascend:
 * 1. HCS topic "ascend-rounds" (prediction reasoning, results, discourse)
 * 2. HCS topic "hcs10-registry" (agent discovery + handshake bootstrap)
 * 3. HTS "ASCEND" fungible token (standalone, not contract-integrated)
 * 3. Saves all resource IDs to deployments.json
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
} from "@hashgraph/sdk";
import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";

// Load env from project root
config({ path: path.resolve(process.cwd(), "../.env") });

// ──────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────

const OPERATOR_ID = process.env.HEDERA_OPERATOR_ID;
const OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY;
const NETWORK = process.env.HEDERA_NETWORK || "testnet";

if (!OPERATOR_ID || !OPERATOR_KEY) {
    console.error("❌ Missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY in .env");
    console.error("   Create a testnet account at https://portal.hedera.com");
    process.exit(1);
}

// ──────────────────────────────────────────
// Initialize Hedera Client
// ──────────────────────────────────────────

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

// ──────────────────────────────────────────
// Step 1: Create HCS Topic — ascend-rounds
// ──────────────────────────────────────────

async function createHCSTopic(client: Client): Promise<string> {
    console.log("\n📡 Creating HCS topic: ascend-rounds...");

    const operatorKey = PrivateKey.fromStringED25519(OPERATOR_KEY!);

    const tx = new TopicCreateTransaction()
        .setTopicMemo("ascend-rounds")
        .setAdminKey(operatorKey.publicKey)
        .setSubmitKey(operatorKey.publicKey) // Only operator can submit
        .setAutoRenewAccountId(AccountId.fromString(OPERATOR_ID!));

    const response = await tx.execute(client);
    const receipt = await response.getReceipt(client);
    const topicId = receipt.topicId!.toString();

    console.log(`   ✅ Topic created: ${topicId}`);

    // Verify with a test message
    console.log("   📝 Sending test message...");
    const testMsg = JSON.stringify({
        type: "SYSTEM",
        message: "Ascend topic initialized",
    });

    const msgTx = new TopicMessageSubmitTransaction()
        .setTopicId(receipt.topicId!)
        .setMessage(testMsg);

    const msgResponse = await msgTx.execute(client);
    await msgResponse.getReceipt(client);
    console.log("   ✅ Test message sent successfully");

    return topicId;
}

// ──────────────────────────────────────────
// Step 2: Create HCS Topic — hcs10-registry
// ──────────────────────────────────────────

async function createHCS10RegistryTopic(client: Client): Promise<string> {
    console.log("\n🛰️  Creating HCS topic: hcs10-registry...");

    const operatorKey = PrivateKey.fromStringED25519(OPERATOR_KEY!);

    const tx = new TopicCreateTransaction()
        .setTopicMemo("hcs10-registry")
        .setAdminKey(operatorKey.publicKey)
        .setAutoRenewAccountId(AccountId.fromString(OPERATOR_ID!));

    const response = await tx.execute(client);
    const receipt = await response.getReceipt(client);
    const topicId = receipt.topicId!.toString();

    console.log(`   ✅ Topic created: ${topicId}`);
    return topicId;
}

// ──────────────────────────────────────────
// Step 3: Create HTS Token — ASCEND
// ──────────────────────────────────────────

async function createHTSToken(client: Client): Promise<string> {
    console.log("\n🪙  Creating HTS token: ASCEND...");

    const operatorKey = PrivateKey.fromStringED25519(OPERATOR_KEY!);
    const operatorId = AccountId.fromString(OPERATOR_ID!);

    const tx = new TokenCreateTransaction()
        .setTokenName("Ascend Intelligence Token")
        .setTokenSymbol("ASCEND")
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(1_000_000_00000000) // 1M tokens with 8 decimals
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
    console.log(`      Name:    Ascend Intelligence Token`);
    console.log(`      Symbol:  ASCEND`);
    console.log(`      Supply:  1,000,000 (8 decimals)`);

    return tokenId;
}

// ──────────────────────────────────────────
// Step 3: Save Deployments
// ──────────────────────────────────────────

interface Deployments {
    network: string;
    operatorId: string;
    hcs: {
        ascendRoundsTopicId: string;
        hcs10RegistryTopicId: string;
    };
    hts: {
        ascendTokenId: string;
    };
    contracts: {
        agentRegistry: string;
        predictionMarket: string;
    };
    createdAt: string;
}

function saveDeployments(topicId: string, registryTopicId: string, tokenId: string): void {
    const deploymentsPath = path.resolve(process.cwd(), "../deployments.json");

    // Merge with existing deployments (from forge script) if they exist
    let existing: Partial<Deployments> = {};
    if (fs.existsSync(deploymentsPath)) {
        existing = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
    }

    const deployments: Deployments = {
        network: NETWORK,
        operatorId: OPERATOR_ID!,
        hcs: {
            ascendRoundsTopicId: topicId,
            hcs10RegistryTopicId: registryTopicId,
        },
        hts: {
            ascendTokenId: tokenId,
        },
        contracts: {
            agentRegistry: existing.contracts?.agentRegistry || "NOT_DEPLOYED",
            predictionMarket: existing.contracts?.predictionMarket || "NOT_DEPLOYED",
        },
        createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
    console.log(`\n📄 Deployments saved to ${deploymentsPath}`);
}

// ──────────────────────────────────────────
// Step 4: Generate .env.example
// ──────────────────────────────────────────

function generateEnvExample(): void {
    const envExamplePath = path.resolve(process.cwd(), "../.env.example");

    const content = `# Hedera Testnet Configuration
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=0.0.XXXXX
HEDERA_OPERATOR_KEY=302e020100...
HEDERA_JSON_RPC=https://testnet.hashio.io/api
HEDERA_MIRROR_NODE=https://testnet.mirrornode.hedera.com

# Deployer private key (ECDSA hex for Foundry)
DEPLOYER_PRIVATE_KEY=0x...

# Contract Addresses (populated after forge deploy)
AGENT_REGISTRY_ADDRESS=0x...
PREDICTION_MARKET_ADDRESS=0x...

# HCS Topics (populated after setup-hedera.ts)
ASCEND_ROUNDS_TOPIC_ID=0.0.XXXXX
HCS10_REGISTRY_TOPIC_ID=0.0.XXXXX

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

# HTS Token (populated after setup-hedera.ts)
ASCEND_TOKEN_ID=0.0.XXXXX

# AI Agent Config
OPENAI_API_KEY=sk-...

# Price Data
COINGECKO_API_KEY=CG-...
`;

    if (!fs.existsSync(envExamplePath)) {
        fs.writeFileSync(envExamplePath, content);
        console.log(`📋 .env.example created at ${envExamplePath}`);
    }
}

// ──────────────────────────────────────────
// Main
// ──────────────────────────────────────────

async function main() {
    console.log("═══════════════════════════════════════════");
    console.log("  ASCEND — Hedera Infrastructure Setup");
    console.log("═══════════════════════════════════════════");
    console.log(`  Network:  ${NETWORK}`);
    console.log(`  Operator: ${OPERATOR_ID}`);

    const client = createClient();

    try {
        // 1. Create HCS topic
        const topicId = await createHCSTopic(client);

        // 2. Create HCS-10 registry topic
        const hcs10RegistryTopicId = await createHCS10RegistryTopic(client);

        // 3. Create HTS token
        const tokenId = await createHTSToken(client);

        // 4. Save deployments
        saveDeployments(topicId, hcs10RegistryTopicId, tokenId);

        // 5. Generate .env.example
        generateEnvExample();

        console.log("\n═══════════════════════════════════════════");
        console.log("  ✅ Setup Complete!");
        console.log("═══════════════════════════════════════════");
        console.log(`  HCS Topic (rounds):  ${topicId}`);
        console.log(`  HCS-10 Registry:     ${hcs10RegistryTopicId}`);
        console.log(`  HTS Token:           ${tokenId}`);
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
