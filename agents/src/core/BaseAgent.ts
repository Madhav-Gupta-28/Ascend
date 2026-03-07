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
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import { ContractClient, createContractClient } from "./contract-client.js";
import { HCSPublisher, createHCSPublisher } from "./hcs-publisher.js";
import { DataCollector, type MarketData } from "./data-collector.js";

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
    }>;
}

export interface AgentConfig {
    agentId: number;
    name: string;
    privateKey: string;     // Agent's own Hedera ECDSA key
    personaPrompt: string;  // LLM context
    pollIntervalMs?: number;
}

export abstract class BaseAgent {
    protected client: ContractClient;
    protected hcs: HCSPublisher;
    protected dataCollector: DataCollector;
    protected config: AgentConfig;

    private stateFilePath: string;
    private state: AgentState;
    private isRunning: boolean = false;
    private openai;

    constructor(config: AgentConfig) {
        this.config = { pollIntervalMs: 10000, ...config };

        // Each agent uses its own private key, NOT the operator key
        const rpcUrl = process.env.HEDERA_JSON_RPC || "https://testnet.hashio.io/api";
        const contracts = require("../../deployments.json").contracts;

        this.client = new ContractClient(
            rpcUrl,
            config.privateKey,
            contracts.agentRegistry,
            contracts.predictionMarket
        );

        // HCS publisher (requires operator key for topic write access currently, 
        // or we use the agent's key + topic allows all submitters)
        // For hackathon: using operator key for HCS submissions to avoid 100x topic permissions
        this.hcs = createHCSPublisher();

        this.dataCollector = new DataCollector(process.env.COINGECKO_API_KEY);

        this.openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // Local state persistence ensures recovery if process crashes between commit/reveal
        this.stateFilePath = path.resolve(process.cwd(), `.cache/agent_${config.agentId}_state.json`);
        this.state = this.loadState();
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
        console.log(`[${this.config.name}] 🔴 Agent runtime stopped.`);
    }

    private async syncWithChain() {
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
        const prediction = await this.analyze(marketData);
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
        };
        this.saveState();

        // 5. Broadcast Commit TX to Hedera EVM
        await this.client.commitPrediction(roundId, this.config.agentId, commitHash, Number(ethers.formatEther(entryFee)));

        this.state.commitments[roundId].committed = true;
        this.state.activeRoundId = roundId;
        this.saveState();

        console.log(`[${this.config.name}] ✅ Committed prediction for round #${roundId}: ${prediction.direction} (${prediction.confidence}%)`);
    }

    private async handleRevealPhase(roundId: number) {
        const data = this.state.commitments[roundId];
        if (!data) return;

        // 1. Publish Reasoning to Hedera Consensus Service
        // Critical security constraint: reasoning must be published AFTER commit hash is locked
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
            // Continue to on-chain reveal even if HCS fails, so we don't get slashed
        }

        // 2. Broadcast Reveal TX to Hedera EVM
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
    }

    // ── LLM Integration ──

    /**
     * Default implementation uses OpenAI GPT-4o with structured JSON output.
     * Can be overridden by subclasses for specific multi-agent strategies.
     */
    protected async analyze(data: MarketData): Promise<{ direction: "UP" | "DOWN", confidence: number, reasoning: string }> {
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

Task: Predict whether the HBAR/USD price will be UP or DOWN over the next round duration.
You must provide a confidence score (0-100) and concise reasoning (under 500 characters).
    `;

        try {
            const { object } = await generateObject({
                model: this.openai('gpt-4o'),
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
}
