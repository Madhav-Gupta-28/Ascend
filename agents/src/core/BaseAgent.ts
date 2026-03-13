/**
 * Ascend — Base Agent Runtime
 * 
 * Decentralized execution loop for AI agents.
 * 1. Detects new rounds
 * 2. Fetches multi-modal data
 * 3. Prompts LLM for direction/confidence/reasoning
 * 4. Commits hash to Hedera
 * 5. Reveals prediction + publishes reasoning to HCS
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";

import { ContractClient, loadDeployments } from "./contract-client.js";
import { HCSPublisher, createHCSPublisher } from "./hcs-publisher.js";
import { DataCollector, type MarketData } from "./data-collector.js";
import { HCS10CommunicationNetwork } from "./hcs10-network.js";
import {
    HederaAgentKitClient,
    createHederaAgentKitFromEnv,
} from "./hedera-agent-kit.js";
import { HOLChatHandler } from "./hol-chat-handler.js";
import { getAgentHOLState } from "./hol-registry.js";

// ── Types ──

export interface AgentState {
    agentId: number;
    name: string;
    activeRoundId: number | null;
    commitments: Record<number, {
        roundId: number;
        direction: 0 | 1;
        confidence: number;
        reasoning: string;
        salt: string;
        commitHash: string;
        committed: boolean;
        revealed: boolean;
        reasoningPublished: boolean;
    }>;
}

export interface AgentConfig {
    agentId: number;
    name: string;
    privateKey: string;     // Agent's own Hedera ECDSA key
    accountId?: string;     // Hedera account id for HCS-10 identity
    personaPrompt: string;  // LLM context
    hcs10Capabilities?: string[];
    pollIntervalMs?: number;
}

export abstract class BaseAgent {
    protected client: ContractClient;
    protected hcs: HCSPublisher;
    protected hcs10: HCS10CommunicationNetwork | null = null;
    protected holChat: HOLChatHandler | null = null;
    protected hederaAgentKit: HederaAgentKitClient | null = null;
    protected dataCollector: DataCollector;
    protected config: AgentConfig;

    private stateFilePath: string;
    private state: AgentState;
    private isRunning: boolean = false;
    private gemini;

    constructor(config: AgentConfig) {
        this.config = { pollIntervalMs: 10000, ...config };

        // Each agent uses its own private key, NOT the operator key
        const rpcUrl = process.env.HEDERA_JSON_RPC || "https://testnet.hashio.io/api";
        const contracts = loadDeployments().contracts;

        this.client = new ContractClient(
            rpcUrl,
            config.privateKey,
            contracts.agentRegistry,
            contracts.predictionMarket,
            contracts.stakingVault
        );

        // HCS publisher (requires operator key for topic write access currently, 
        // or we use the agent's key + topic allows all submitters)
        // For hackathon: using operator key for HCS submissions to avoid 100x topic permissions
        this.hcs = createHCSPublisher();
        this.hcs10 = this.createHCS10Network();
        try {
            this.hederaAgentKit = createHederaAgentKitFromEnv();
        } catch (error: any) {
            console.warn(
                `[${this.config.name}] Hedera Agent Kit disabled: ${error?.message || String(error)}`,
            );
        }

        this.holChat = this.createHOLChatHandler();

        this.dataCollector = new DataCollector(process.env.COINGECKO_API_KEY);

        this.gemini = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

        // Local state persistence ensures recovery if process crashes between commit/reveal
        this.stateFilePath = path.resolve(process.cwd(), `.cache/agent_${config.agentId}_state.json`);
        this.state = this.loadState();
    }

    private createHCS10Network(): HCS10CommunicationNetwork | null {
        const registryTopicId = process.env.HCS10_REGISTRY_TOPIC_ID;
        if (!registryTopicId) {
            return null;
        }

        const idPrefix = this.config.name.toUpperCase();
        const accountId =
            process.env[`${idPrefix}_HCS10_ACCOUNT_ID`] ||
            this.config.accountId ||
            process.env.HEDERA_OPERATOR_ID;
        if (!accountId) {
            console.warn(`[${this.config.name}] HCS-10 disabled: missing account id`);
            return null;
        }

        const privateKey =
            process.env[`${idPrefix}_HCS10_PRIVATE_KEY`] ||
            process.env.HEDERA_OPERATOR_KEY ||
            this.config.privateKey;
        if (!privateKey) {
            console.warn(`[${this.config.name}] HCS-10 disabled: missing private key`);
            return null;
        }

        const inboundTopicId = process.env[`${idPrefix}_HCS10_INBOUND_TOPIC_ID`];
        const outboundTopicId = process.env[`${idPrefix}_HCS10_OUTBOUND_TOPIC_ID`];

        return new HCS10CommunicationNetwork({
            network: (process.env.HEDERA_NETWORK as "testnet" | "mainnet" | undefined) ?? "testnet",
            operatorAccountId: accountId,
            operatorPrivateKey: privateKey,
            registryTopicId,
            agentId: String(this.config.agentId),
            agentName: this.config.name,
            inboundTopicId,
            outboundTopicId,
            autoCreateTopics: !(inboundTopicId && outboundTopicId),
            capabilities: this.config.hcs10Capabilities ?? ["reasoning", "qa"],
            mirrorNodeBaseUrl: process.env.HEDERA_MIRROR_NODE,
        });
    }

    private createHOLChatHandler(): HOLChatHandler | null {
        const holState = getAgentHOLState(this.config.name);
        if (!holState) {
            console.warn(
                `[${this.config.name}] HOL Chat disabled: no HOL registration state found. Register agent via the frontend or run 'npm run register:hol'.`,
            );
            return null;
        }

        return new HOLChatHandler({
            agentName: this.config.name,
            personaPrompt: this.config.personaPrompt,
            registrationState: holState,
            getAgentContext: async () => {
                try {
                    const agent = await this.client.getAgent(this.config.agentId);
                    return [
                        `CredScore: ${agent.credScore}`,
                        `Accuracy: ${agent.totalPredictions > 0 ? ((Number(agent.correctPredictions) / Number(agent.totalPredictions)) * 100).toFixed(1) : "N/A"}%`,
                        `Total Predictions: ${agent.totalPredictions}`,
                        `Correct: ${agent.correctPredictions}`,
                    ].join("\n");
                } catch {
                    return "On-chain stats temporarily unavailable.";
                }
            },
        });
    }

    // ── State Management ──

    private loadState(): AgentState {
        if (fs.existsSync(this.stateFilePath)) {
            try {
                return JSON.parse(fs.readFileSync(this.stateFilePath, "utf-8"));
            } catch (e) {
                console.error(`[${this.config.name}] Error loading state:`, e);
            }
        }
        return {
            agentId: this.config.agentId,
            name: this.config.name,
            activeRoundId: null,
            commitments: {},
        };
    }

    private saveState() {
        const dir = path.dirname(this.stateFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
    }

    // ── Execution Loop ──

    public async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`[${this.config.name}] 🟢 Agent runtime started. Polling every ${this.config.pollIntervalMs}ms...`);

        if (this.hcs10) {
            try {
                await this.hcs10.bootstrap();
                const identity = this.hcs10.getIdentity();
                console.log(
                    `[${this.config.name}] 🔗 HCS-10 identity ready (${identity.operatorId}, inbound=${identity.inboundTopicId}, outbound=${identity.outboundTopicId})`,
                );
            } catch (error: any) {
                console.error(`[${this.config.name}] ⚠️ HCS-10 bootstrap failed: ${error.message}`);
            }
        }

        if (this.hederaAgentKit) {
            try {
                const balance = await this.hederaAgentKit.getHbarBalance();
                const methods = this.hederaAgentKit.getEnabledMethods();
                console.log(
                    `[${this.config.name}] 🧰 Hedera Agent Kit ready (${methods.length} tools): ${balance.humanMessage || "operator balance fetched"}`,
                );
            } catch (error: any) {
                console.error(
                    `[${this.config.name}] ⚠️ Hedera Agent Kit startup check failed: ${error?.message || String(error)}`,
                );
            }
        }

        if (this.holChat) {
            console.log(
                `[${this.config.name}] 💬 HOL Chat handler active (accepting HCS-10 connections)`,
            );
        }

        while (this.isRunning) {
            try {
                await this.syncWithChain();
            } catch (error: any) {
                console.error(`[${this.config.name}] ❌ Loop error:`, error.message);
            }
            await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
        }
    }

    public stop() {
        this.isRunning = false;
        if (this.hederaAgentKit) {
            this.hederaAgentKit.close();
        }
        console.log(`[${this.config.name}] 🔴 Agent runtime stopped.`);
    }

    private async syncWithChain() {
        if (this.hcs10) {
            try {
                await this.hcs10.sync();
                await this.handleUserQuestions();
            } catch (err: any) {
                console.error(`[${this.config.name}] ⚠️ HCS-10 sync failed: ${err.message}`);
            }
        }

        if (this.holChat) {
            try {
                await this.holChat.poll();
            } catch (err: any) {
                console.error(`[${this.config.name}] ⚠️ HOL Chat poll failed: ${err.message}`);
            }
        }

        const roundCount = await this.client.getRoundCount();
        if (roundCount === 0) return;

        // We look at the most recent round
        const latestRoundId = roundCount;
        const round = await this.client.getRound(latestRoundId);

        // 0 = Committing, 1 = Revealing
        const isCommittingPhase = round.status === 0 && Date.now() / 1000 <= Number(round.commitDeadline);
        const isRevealingPhase = (round.status === 0 || round.status === 1) &&
            Date.now() / 1000 > Number(round.commitDeadline) &&
            Date.now() / 1000 <= Number(round.revealDeadline);

        // 1. Commit logic
        if (isCommittingPhase) {
            if (!this.state.commitments[latestRoundId]?.committed) {
                console.log(`[${this.config.name}] 📡 New round #${latestRoundId} detected. Generating prediction...`);
                await this.handleCommitPhase(latestRoundId, round.entryFee);
            }
        }

        // 2. Reveal logic
        if (isRevealingPhase) {
            const commitment = this.state.commitments[latestRoundId];
            if (commitment && commitment.committed && !commitment.revealed) {
                console.log(`[${this.config.name}] 🔓 Reveal phase active for round #${latestRoundId}. Revealing...`);
                await this.handleRevealPhase(latestRoundId);
            }
        }
    }

    // ── Phase Implementations ──

    private async handleCommitPhase(roundId: number, entryFee: bigint) {
        // 1. Collect Data
        const marketData = await this.dataCollector.collectMarketData();

        // 2. LLM Analysis
        const prediction = await this.analyze(marketData, { roundId });
        const directionNum = prediction.direction === "UP" ? 0 : 1;

        // 3. Crypto Security: Generate Salt & Hash
        const salt = ContractClient.generateSalt();
        const commitHash = ContractClient.computeCommitHash(directionNum, prediction.confidence, salt);

        // 4. Save local state BEFORE broadcasting transaction (crash recovery)
        this.state.commitments[roundId] = {
            roundId,
            direction: directionNum,
            confidence: prediction.confidence,
            reasoning: prediction.reasoning,
            salt,
            commitHash,
            committed: false,
            revealed: false,
            reasoningPublished: false,
        };
        this.saveState();

        // 5. Broadcast Commit TX to Hedera EVM
        await this.client.commitPrediction(
            roundId,
            this.config.agentId,
            commitHash,
            Number(ethers.formatUnits(entryFee, 8)),
        );

        this.state.commitments[roundId].committed = true;
        this.state.activeRoundId = roundId;
        this.saveState();

        try {
            await this.hcs.publishReasoning(
                roundId,
                this.config.name.toLowerCase(),
                undefined,
                prediction.confidence,
                prediction.reasoning,
            );
        } catch (err: any) {
            console.error(`[${this.config.name}] ⚠️ Failed to publish pre-reveal HCS reasoning: ${err.message}`);
        }

        await this.publishReasoningToHCS10(roundId);

        console.log(`[${this.config.name}] ✅ Committed prediction for round #${roundId}: ${prediction.direction} (${prediction.confidence}%)`);
    }

    private async publishReasoningToHCS10(roundId: number): Promise<void> {
        const commitment = this.state.commitments[roundId];
        if (!commitment || commitment.reasoningPublished) return;
        if (!this.hcs10) return;

        try {
            const peersReached = await this.hcs10.publishReasoning(
                roundId,
                commitment.commitHash,
                commitment.confidence,
                commitment.reasoning,
            );
            commitment.reasoningPublished = true;
            this.saveState();
            console.log(
                `[${this.config.name}] 🧠 Published HCS-10 reasoning for round #${roundId} to ${peersReached} peer connections`,
            );
        } catch (err: any) {
            console.error(`[${this.config.name}] ⚠️ Failed to publish HCS-10 reasoning: ${err.message}`);
        }
    }

    private async handleRevealPhase(roundId: number) {
        const data = this.state.commitments[roundId];
        if (!data) return;

        // 1. Broadcast Reveal TX to Hedera EVM
        await this.client.revealPrediction(
            roundId,
            this.config.agentId,
            data.direction,
            data.confidence,
            data.salt
        );

        data.revealed = true;
        this.saveState();
        console.log(`[${this.config.name}] 🔓 Revealed prediction for round #${roundId} on-chain.`);

        // 2. Publish full reasoning only after reveal is on-chain.
        try {
            const hcsRes = await this.hcs.publishReasoning(
                roundId,
                this.config.name.toLowerCase(),
                data.direction === 0 ? "UP" : "DOWN",
                data.confidence,
                data.reasoning
            );
            console.log(`[${this.config.name}] 📨 Published reasoning to HCS (seq #${hcsRes.sequenceNumber})`);
        } catch (err: any) {
            console.error(`[${this.config.name}] ⚠️ Failed to publish HCS reasoning: ${err.message}`);
        }
    }

    // ── LLM Integration ──

    /**
     * Default implementation uses OpenAI GPT-4o with structured JSON output.
     * Can be overridden by subclasses for specific multi-agent strategies.
     */
    protected async analyze(
        data: MarketData,
        context?: { roundId?: number },
    ): Promise<{ direction: "UP" | "DOWN", confidence: number, reasoning: string }> {
        const roundId = context?.roundId;
        const peerReasoningContext =
            this.hcs10 && roundId
                ? this.hcs10.getReasoningContext(roundId, 6)
                : "No peer reasoning context available.";

        const prompt = `
${this.config.personaPrompt}

Current Market Data:
Price: $${data.price.currentPrice.toFixed(4)}
24h Change: ${data.price.change24hPct.toFixed(2)}%
24h High: $${data.price.high24h.toFixed(4)}
24h Low: $${data.price.low24h.toFixed(4)}
24h Volume: $${data.price.volume24h.toLocaleString()}

Recent OHLC (last ${data.ohlc.length} periods):
${JSON.stringify(data.ohlc, null, 2)}

Peer Reasoning Context (HCS-10):
${peerReasoningContext}

Task: Predict whether the HBAR/USD price will be UP or DOWN over the next round duration.
You must provide a confidence score (0-100) and concise reasoning (under 500 characters).
    `;

        try {
            const { object } = await generateObject({
                model: this.gemini('gemini-1.5-pro'),
                schema: z.object({
                    direction: z.enum(['UP', 'DOWN']),
                    confidence: z.number().min(0).max(100),
                    reasoning: z.string().max(800)
                }),
                prompt,
            });

            return object;
        } catch (error) {
            console.error(`[${this.config.name}] LLM Generation failed, using safe fallback.`, error);
            // Safe fallback to prevent slashing for non-participation
            return {
                direction: "UP",
                confidence: 50,
                reasoning: "LLM timeout. Defaulting to safe neutral historical upward bias."
            };
        }
    }

    private async handleUserQuestions(): Promise<void> {
        if (!this.hcs10) return;

        const questions = this.hcs10.drainQuestionInbox();
        if (questions.length === 0) return;

        for (const q of questions) {
            try {
                const prompt = `
You are ${this.config.name}, an AI trading agent on Ascend.
Answer the user's question concisely and honestly.
If the question asks for certainty, state uncertainty explicitly.

Question:
${q.payload.question}
                `;

                const { object } = await generateObject({
                    model: this.gemini('gemini-1.5-flash'),
                    schema: z.object({
                        answer: z.string().min(1).max(1200),
                        confidence: z.number().min(0).max(100),
                    }),
                    prompt,
                });

                await this.hcs10.sendAnswer(
                    q.connectionTopicId,
                    q.payload.questionId,
                    object.answer,
                    object.confidence,
                );

                console.log(
                    `[${this.config.name}] 💬 Answered user question ${q.payload.questionId} on ${q.connectionTopicId}`,
                );
            } catch (error: any) {
                console.error(
                    `[${this.config.name}] ⚠️ Failed to answer question ${q.payload.questionId}: ${error.message}`,
                );
            }
        }
    }
}
