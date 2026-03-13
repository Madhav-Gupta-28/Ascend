/**
 * Ascend — HOL Registry Integration
 *
 * Registers Ascend AI agents in the Hashgraph Online (HOL) Guarded Registry
 * using the official @hashgraphonline/standards-sdk.
 *
 * This enables:
 * - Agent discovery on hol.org/registry
 * - HCS-10 compliant inbound/outbound topics
 * - HCS-11 profile with capabilities metadata
 * - External agents connecting via standard HCS-10 handshake
 */

import {
    HCS10Client,
    AgentBuilder,
    AIAgentCapability,
    InboundTopicType,
} from "@hashgraphonline/standards-sdk";
import * as fs from "node:fs";
import * as path from "node:path";

export interface AgentHOLConfig {
    name: string;
    alias: string;
    description: string;
    bio: string;
    capabilities: AIAgentCapability[];
    model: string;
    properties?: Record<string, string>;
}

export interface HOLRegistrationState {
    accountId: string;
    privateKey: string;
    inboundTopicId: string;
    outboundTopicId: string;
    profileTopicId: string;
    registeredAt: string;
    uaid?: string;
}

const STATE_DIR = process.env.HOL_STATE_DIR || path.resolve(process.cwd(), ".cache");

function stateFilePath(agentName: string): string {
    return path.join(STATE_DIR, `hol_${agentName.toLowerCase()}_state.json`);
}

function loadState(agentName: string): HOLRegistrationState | null {
    const fp = stateFilePath(agentName);
    if (!fs.existsSync(fp)) return null;
    try {
        return JSON.parse(fs.readFileSync(fp, "utf-8")) as HOLRegistrationState;
    } catch {
        return null;
    }
}

function saveState(agentName: string, state: HOLRegistrationState): void {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(stateFilePath(agentName), JSON.stringify(state, null, 2));
}

export function createHCS10Client(): HCS10Client {
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    const network = (process.env.HEDERA_NETWORK as "testnet" | "mainnet") ?? "testnet";

    if (!operatorId || !operatorKey) {
        throw new Error("HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY are required for HOL registration");
    }

    return new HCS10Client({
        network,
        operatorId,
        operatorPrivateKey: operatorKey,
        logLevel: "info",
    });
}

export async function registerAgent(
    client: HCS10Client,
    config: AgentHOLConfig,
): Promise<HOLRegistrationState> {
    const existing = loadState(config.name);
    if (existing) {
        console.log(`[HOL] ${config.name} already registered (account: ${existing.accountId})`);
        return existing;
    }

    console.log(`[HOL] Registering ${config.name} in HOL Registry...`);

    const builder = new AgentBuilder()
        .setName(`Ascend: ${config.name}`)
        .setAlias(config.alias)
        .setDescription(config.description)
        .setBio(config.bio)
        .setAgentType("autonomous")
        .setCapabilities(config.capabilities)
        .setModel(config.model)
        .setCreator("Ascend Intelligence Market")
        .setNetwork((process.env.HEDERA_NETWORK as "testnet" | "mainnet") ?? "testnet")
        .setInboundTopicType(InboundTopicType.PUBLIC);

    if (config.properties) {
        for (const [key, value] of Object.entries(config.properties)) {
            builder.addProperty(key, value);
        }
    }

    const result = await client.createAndRegisterAgent(builder, {
        progressCallback: (progress) => {
            console.log(`[HOL] ${config.name}: ${JSON.stringify(progress)}`);
        },
    });

    if (!result.success || !result.metadata) {
        throw new Error(`HOL registration failed for ${config.name}: ${result.error ?? "unknown error"}`);
    }

    const state: HOLRegistrationState = {
        accountId: result.metadata.accountId,
        privateKey: result.metadata.privateKey,
        inboundTopicId: result.metadata.inboundTopicId,
        outboundTopicId: result.metadata.outboundTopicId,
        profileTopicId: result.metadata.profileTopicId,
        registeredAt: new Date().toISOString(),
    };

    // NOTE: createAndRegisterAgent already handles guarded registry registration internally.
    // No need to call registerAgentWithGuardedRegistry separately.

    saveState(config.name, state);
    console.log(`[HOL] ${config.name} registered successfully:`);
    console.log(`  Account: ${state.accountId}`);
    console.log(`  Inbound: ${state.inboundTopicId}`);
    console.log(`  Outbound: ${state.outboundTopicId}`);
    console.log(`  Profile: ${state.profileTopicId}`);

    return state;
}

export function getAgentHOLState(agentName: string): HOLRegistrationState | null {
    return loadState(agentName);
}

// Agent configurations for the 4 Ascend agents
export const ASCEND_AGENT_CONFIGS: AgentHOLConfig[] = [
    {
        name: "Sentinel",
        alias: "sentinel",
        description:
            "Sentinel is a disciplined technical analysis agent on the Ascend Intelligence Market. " +
            "It analyzes HBAR/USD using RSI, MACD, Bollinger Bands, and volume trends to produce " +
            "confidence-weighted price predictions recorded on Hedera Consensus Service.",
        bio: "Conservative technical analyst. RSI + MACD + Bollinger Bands. High-conviction only when signals align.",
        capabilities: [
            AIAgentCapability.TEXT_GENERATION,
            AIAgentCapability.MARKET_INTELLIGENCE,
            AIAgentCapability.DATA_INTEGRATION,
        ],
        model: "gemini-1.5-pro",
        properties: {
            strategy: "Technical Analysis",
            platform: "Ascend Intelligence Market",
            asset: "HBAR/USD",
            website: "https://ascend.market",
        },
    },
    {
        name: "Pulse",
        alias: "pulse",
        description:
            "Pulse is an aggressive sentiment and momentum trading agent on Ascend. " +
            "It analyzes social buzz, news sentiment, partnership announcements, and whale movements " +
            "to produce high-conviction price predictions recorded on Hedera.",
        bio: "Aggressive sentiment trader. Bold calls based on market psychology, news flow, and social signals.",
        capabilities: [
            AIAgentCapability.TEXT_GENERATION,
            AIAgentCapability.MARKET_INTELLIGENCE,
            AIAgentCapability.DATA_INTEGRATION,
        ],
        model: "gemini-1.5-pro",
        properties: {
            strategy: "Sentiment Analysis",
            platform: "Ascend Intelligence Market",
            asset: "HBAR/USD",
        },
    },
    {
        name: "Meridian",
        alias: "meridian",
        description:
            "Meridian is a mean-reversion strategist on Ascend. " +
            "It measures how far HBAR/USD has deviated from its moving averages and predicts " +
            "price reversals with steady, methodical confidence scores.",
        bio: "Contrarian mean-reversion analyst. Buys oversold, sells overbought. Steady and methodical.",
        capabilities: [
            AIAgentCapability.TEXT_GENERATION,
            AIAgentCapability.MARKET_INTELLIGENCE,
            AIAgentCapability.TRANSACTION_ANALYTICS,
        ],
        model: "gemini-1.5-pro",
        properties: {
            strategy: "Mean Reversion",
            platform: "Ascend Intelligence Market",
            asset: "HBAR/USD",
        },
    },
    {
        name: "Oracle",
        alias: "oracle",
        description:
            "Oracle is a meta-analysis agent on Ascend that synthesizes reasoning from Sentinel, " +
            "Pulse, and Meridian via HCS-10 communication. It weighs competing analyses to form " +
            "consensus predictions, embodying multi-agent coordination on Hedera.",
        bio: "Meta-analyst synthesizing peer agent reasoning. Multi-agent coordination via HCS-10.",
        capabilities: [
            AIAgentCapability.TEXT_GENERATION,
            AIAgentCapability.KNOWLEDGE_RETRIEVAL,
            AIAgentCapability.MARKET_INTELLIGENCE,
            AIAgentCapability.MULTI_AGENT_COORDINATION,
        ],
        model: "gemini-1.5-pro",
        properties: {
            strategy: "Meta-Analysis (Multi-Agent Synthesis)",
            platform: "Ascend Intelligence Market",
            asset: "HBAR/USD",
        },
    },
];

export async function registerAllAgents(): Promise<Map<string, HOLRegistrationState>> {
    const client = createHCS10Client();
    const results = new Map<string, HOLRegistrationState>();

    for (const config of ASCEND_AGENT_CONFIGS) {
        try {
            const state = await registerAgent(client, config);
            results.set(config.name, state);
        } catch (err: any) {
            console.error(`[HOL] Failed to register ${config.name}: ${err.message}`);
        }
    }

    return results;
}
