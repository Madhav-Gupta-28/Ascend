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
import { generateObject, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
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
    private readonly chatOnlyMode: boolean;
    private gemini: ReturnType<typeof createGoogleGenerativeAI> | null;
    private groq: ReturnType<typeof createOpenAI> | null;

    constructor(config: AgentConfig) {
        this.config = { pollIntervalMs: 10000, ...config };
        this.chatOnlyMode = process.env.ASCEND_CHAT_ONLY === "true";

        // Each agent uses its own private key, NOT the operator key
        const rpcUrl = process.env.HEDERA_JSON_RPC || "https://testnet.hashio.io/api";
        const deployments = loadDeployments();
        const contracts = {
            agentRegistry:
                process.env.AGENT_REGISTRY_ADDRESS || deployments.contracts.agentRegistry,
            predictionMarket:
                process.env.PREDICTION_MARKET_ADDRESS || deployments.contracts.predictionMarket,
            stakingVault:
                process.env.STAKING_VAULT_ADDRESS || deployments.contracts.stakingVault,
        };

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

        const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
        this.gemini = geminiKey
            ? createGoogleGenerativeAI({ apiKey: geminiKey })
            : null;

        const groqKey = (process.env.GROQ_API_KEY || "").trim();
        this.groq = groqKey
            ? createOpenAI({
                  apiKey: groqKey,
                  baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
              })
            : null;

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
        if (this.chatOnlyMode) {
            console.log(
                `[${this.config.name}] 💬 Chat-only mode enabled (round commit/reveal disabled)`,
            );
        }

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

        if (this.chatOnlyMode) {
            return;
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

    private parseModelList(raw: string | undefined): string[] {
        if (!raw) return [];
        return raw
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean);
    }

    private getAnalysisModelCandidates(): Array<{ provider: "groq" | "gemini"; model: string }> {
        const candidates: Array<{ provider: "groq" | "gemini"; model: string }> = [];

        if (this.groq) {
            for (const model of [
                ...this.parseModelList(process.env.GROQ_ANALYSIS_MODELS),
                ...this.parseModelList(process.env.GROQ_MODELS),
                (process.env.GROQ_ANALYSIS_MODEL || "").trim(),
                (process.env.GROQ_MODEL || "").trim(),
                "llama-3.3-70b-versatile",
                "llama-3.1-8b-instant",
            ]) {
                if (model) candidates.push({ provider: "groq", model });
            }
        }

        if (this.gemini) {
            for (const model of [
                ...this.parseModelList(process.env.GEMINI_ANALYSIS_MODELS),
                (process.env.GEMINI_ANALYSIS_MODEL || "").trim(),
                "gemini-1.5-pro",
                "gemini-2.0-flash",
            ]) {
                if (model) candidates.push({ provider: "gemini", model });
            }
        }

        const deduped: Array<{ provider: "groq" | "gemini"; model: string }> = [];
        const seen = new Set<string>();
        for (const c of candidates) {
            const key = `${c.provider}:${c.model}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(c);
        }
        return deduped;
    }

    private extractJsonObject(text: string): unknown {
        const raw = text.trim();
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start < 0 || end < 0 || end <= start) {
            throw new Error("Model response did not contain a JSON object");
        }
        const json = raw.slice(start, end + 1);
        return JSON.parse(json);
    }

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

        const schema = z.object({
            direction: z.enum(["UP", "DOWN"]),
            confidence: z.number().min(0).max(100),
            reasoning: z.string().max(800),
        });

        for (const candidate of this.getAnalysisModelCandidates()) {
            try {
                if (candidate.provider === "groq") {
                    const { text } = await generateText({
                        model: this.groq!(candidate.model),
                        prompt: `${prompt}

Return ONLY a JSON object with keys:
- direction: "UP" or "DOWN"
- confidence: number between 0 and 100
- reasoning: concise string (max 800 chars)
                        `.trim(),
                    });
                    const parsed = schema.parse(this.extractJsonObject(text));
                    return parsed;
                } else {
                    const { object } = await generateObject({
                        model: this.gemini!(candidate.model),
                        schema,
                        prompt,
                    });
                    return object;
                }
            } catch (error: any) {
                console.warn(
                    `[${this.config.name}] ⚠️ Analysis model ${candidate.provider}/${candidate.model} unavailable: ${error?.message || String(error)}`,
                );
            }
        }

        console.error(
            `[${this.config.name}] LLM generation failed across all providers, using safe fallback.`,
        );
        return {
            direction: "UP",
            confidence: 50,
            reasoning: "LLM timeout. Defaulting to safe neutral historical upward bias.",
        };
    }

    private getChatModelCandidates(): Array<{ provider: "groq" | "gemini"; model: string }> {
        const candidates: Array<{ provider: "groq" | "gemini"; model: string }> = [];

        if (this.groq) {
            for (const model of [
                ...this.parseModelList(process.env.GROQ_CHAT_MODELS),
                ...this.parseModelList(process.env.GROQ_MODELS),
                (process.env.GROQ_CHAT_MODEL || "").trim(),
                (process.env.GROQ_MODEL || "").trim(),
                "llama-3.3-70b-versatile",
                "llama-3.1-8b-instant",
            ]) {
                if (model) candidates.push({ provider: "groq", model });
            }
        }

        if (this.gemini) {
            for (const model of [
                ...this.parseModelList(process.env.GEMINI_CHAT_MODELS),
                (process.env.GEMINI_CHAT_MODEL || "").trim(),
                "gemini-2.0-flash",
                "gemini-2.0-flash-lite",
                "gemini-1.5-flash",
            ]) {
                if (model) candidates.push({ provider: "gemini", model });
            }
        }

        const deduped: Array<{ provider: "groq" | "gemini"; model: string }> = [];
        const seen = new Set<string>();
        for (const c of candidates) {
            const key = `${c.provider}:${c.model}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(c);
        }
        return deduped;
    }

    private async generateChatAnswer(prompt: string): Promise<{ answer: string; confidence: number }> {
        const schema = z.object({
            answer: z.string().min(1).max(1200),
            confidence: z.number().min(0).max(100),
        });

        let lastError: unknown = null;
        for (const candidate of this.getChatModelCandidates()) {
            try {
                if (candidate.provider === "groq") {
                    const { text } = await generateText({
                        model: this.groq!(candidate.model),
                        prompt: `${prompt}

Return ONLY a JSON object with keys:
- answer: short answer text (max 1200 chars)
- confidence: number from 0 to 100
                        `.trim(),
                    });
                    return schema.parse(this.extractJsonObject(text));
                } else {
                    const { object } = await generateObject({
                        model: this.gemini!(candidate.model),
                        schema,
                        prompt,
                    });
                    return object;
                }
            } catch (error: any) {
                lastError = error;
                console.warn(
                    `[${this.config.name}] ⚠️ Chat model ${candidate.provider}/${candidate.model} unavailable: ${error?.message || String(error)}`,
                );
            }
        }

        throw lastError ?? new Error("No compatible model available for chat answers");
    }

    private getStrategySummary(): string {
        const name = this.config.name.toLowerCase();
        if (name.includes("sentinel")) return "a technical-analysis momentum agent";
        if (name.includes("pulse")) return "a sentiment and order-flow analysis agent";
        if (name.includes("meridian")) return "a mean-reversion probability agent";
        if (name.includes("oracle")) return "a meta-ensemble agent that combines peer signals";
        return "an Ascend prediction agent";
    }

    private async getAgentMetricStrings(): Promise<{ credScoreText: string; accuracyText: string }> {
        let credScoreText = "unknown";
        let accuracyText = "unknown";

        try {
            const agent = await this.client.getAgent(this.config.agentId);
            const credScore =
                typeof agent.credScore === "number"
                    ? agent.credScore
                    : Number(agent.credScore);
            if (Number.isFinite(credScore)) {
                credScoreText = String(Math.trunc(credScore));
            }

            const totalPredictions = Number(agent.totalPredictions);
            const correctPredictions = Number(agent.correctPredictions);
            if (Number.isFinite(totalPredictions) && totalPredictions > 0 && Number.isFinite(correctPredictions)) {
                const computed = (correctPredictions / totalPredictions) * 100;
                accuracyText = `${computed.toFixed(1)}%`;
            }
        } catch {
            // Use default unknown metrics if chain fetch fails.
        }

        return { credScoreText, accuracyText };
    }

    private async buildFallbackChatAnswer(question: string): Promise<{ answer: string; confidence: number }> {
        const { credScoreText, accuracyText } = await this.getAgentMetricStrings();

        const loweredQuestion = question.toLowerCase();
        const strategy = this.getStrategySummary();
        const lead = loweredQuestion.includes("strategy")
            ? `My strategy is ${strategy}.`
            : `I am ${this.config.name}, ${strategy}.`;
        const answer = `${lead} My current CredScore is ${credScoreText} with ${accuracyText} accuracy.`;
        return { answer, confidence: 58 };
    }

    private async handleUserQuestions(): Promise<void> {
        if (!this.hcs10) return;

        const questions = this.hcs10.drainQuestionInbox();
        if (questions.length === 0) return;

        for (const q of questions) {
            try {
                const strategy = this.getStrategySummary();
                const { credScoreText, accuracyText } = await this.getAgentMetricStrings();
                const prompt = `
You are ${this.config.name}, an AI trading agent on Ascend.
Answer the user's question concisely and honestly.
If the question asks for certainty, state uncertainty explicitly.
Never fabricate on-chain stats. Use the verified snapshot below when asked:
- CredScore: ${credScoreText}
- Accuracy: ${accuracyText}
- Strategy: ${strategy}
If stats are "unknown", say they are temporarily unavailable.

Question:
${q.payload.question}
                `;

                let object: { answer: string; confidence: number };
                try {
                    object = await this.generateChatAnswer(prompt);
                } catch (error: any) {
                    console.warn(
                        `[${this.config.name}] ⚠️ Falling back to deterministic chat answer: ${error?.message || String(error)}`,
                    );
                    object = await this.buildFallbackChatAnswer(q.payload.question);
                }

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
