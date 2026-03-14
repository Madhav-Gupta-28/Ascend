/**
 * Ascend — HOL Chat Handler
 *
 * Handles natural language chat sessions with users via the official
 * HCS-10 protocol using @hashgraphonline/standards-sdk.
 *
 * This satisfies the Hashgraph Online bounty requirement:
 * "Ensure users can chat with your agent using natural language
 *  and interface with your Apex Hackathon Decentralized Application."
 *
 * Flow:
 * 1. External user/agent sends connection_request to agent's inbound topic
 * 2. Handler accepts and creates a connection topic
 * 3. User sends messages on the connection topic
 * 4. Handler generates LLM response in-character and replies
 */

import { HCS10Client } from "@hashgraphonline/standards-sdk";
import { generateObject, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

import { type HOLRegistrationState } from "./hol-registry.js";

export interface HOLChatConfig {
    agentName: string;
    personaPrompt: string;
    registrationState: HOLRegistrationState;
    /** Get live agent stats for context-aware responses */
    getAgentContext?: () => Promise<string>;
}

interface ChatState {
    connections: Record<string, {
        connectionTopicId: string;
        remoteAccountId: string;
        createdAt: number;
        lastMessageSeq: number;
    }>;
    lastInboundSeq: number;
}

export class HOLChatHandler {
    private client: HCS10Client;
    private config: HOLChatConfig;
    private gemini: ReturnType<typeof createGoogleGenerativeAI> | null;
    private groq: ReturnType<typeof createOpenAI> | null;
    private chatState: ChatState;
    private stateFilePath: string;
    private initialized = false;

    constructor(config: HOLChatConfig) {
        this.config = config;

        const operatorId = process.env.HEDERA_OPERATOR_ID!;
        const operatorKey = process.env.HEDERA_OPERATOR_KEY!;
        const network = (process.env.HEDERA_NETWORK as "testnet" | "mainnet") ?? "testnet";

        // Use the agent's own credentials for chat operations
        this.client = new HCS10Client({
            network,
            operatorId: config.registrationState.accountId,
            operatorPrivateKey: config.registrationState.privateKey,
            logLevel: "warn",
        });

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

        this.stateFilePath = path.resolve(
            process.cwd(),
            `.cache/hol_chat_${config.agentName.toLowerCase()}_state.json`,
        );
        this.chatState = this.loadChatState();
    }

    async poll(): Promise<void> {
        try {
            await this.handleInboundConnectionRequests();
            await this.handleIncomingMessages();
        } catch (err: any) {
            console.error(`[HOL-Chat] ${this.config.agentName} poll error: ${err.message}`);
        }
    }

    private async handleInboundConnectionRequests(): Promise<void> {
        const inboundTopicId = this.config.registrationState.inboundTopicId;

        try {
            const { messages } = await this.client.getMessages(inboundTopicId);

            for (const msg of messages) {
                if (msg.op !== "connection_request") continue;
                if (msg.sequence_number <= this.chatState.lastInboundSeq) continue;

                this.chatState.lastInboundSeq = msg.sequence_number;

                // Check if we already have a connection with this operator
                const existingConnection = Object.values(this.chatState.connections).find(
                    (c) => c.remoteAccountId === msg.operator_id,
                );
                if (existingConnection) continue;

                const operatorIdStr = msg.operator_id ?? "";
                try {
                    const requestingAccountId = operatorIdStr.includes("@")
                        ? operatorIdStr.split("@")[1]
                        : operatorIdStr;
                    const connResult = await this.client.handleConnectionRequest(
                        inboundTopicId,
                        requestingAccountId,
                        msg.sequence_number,
                    );

                    if (connResult?.connectionTopicId) {
                        this.chatState.connections[connResult.connectionTopicId] = {
                            connectionTopicId: connResult.connectionTopicId,
                            remoteAccountId: operatorIdStr,
                            createdAt: Date.now(),
                            lastMessageSeq: 0,
                        };
                        this.saveChatState();

                        console.log(
                            `[HOL-Chat] ${this.config.agentName} accepted connection from ${operatorIdStr} -> ${connResult.connectionTopicId}`,
                        );

                        // Send welcome message
                        await this.client.sendMessage(
                            connResult.connectionTopicId,
                            `Hello! I'm ${this.config.agentName}, an AI agent on the Ascend Intelligence Market. ` +
                            `I analyze HBAR/USD price movements and compete in prediction rounds. ` +
                            `Ask me about my strategy, current market analysis, or prediction track record.`,
                        );
                    }
                } catch (err: any) {
                    console.error(
                        `[HOL-Chat] ${this.config.agentName} failed to accept connection from ${operatorIdStr}: ${err.message}`,
                    );
                }
            }
        } catch (err: any) {
            // Suppress topic-not-found errors during initial setup
            if (!err.message?.includes("404")) {
                throw err;
            }
        }
    }

    private async handleIncomingMessages(): Promise<void> {
        for (const [topicId, conn] of Object.entries(this.chatState.connections)) {
            try {
                const { messages } = await this.client.getMessages(topicId);

                for (const msg of messages) {
                    if (msg.sequence_number <= conn.lastMessageSeq) continue;
                    conn.lastMessageSeq = msg.sequence_number;

                    // Skip our own messages and non-message ops
                    if (msg.op !== "message") continue;

                    const content = typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data);
                    if (!content || content.length < 2) continue;

                    // Check if this message is from us (skip our own messages)
                    const operatorId = `${this.config.registrationState.inboundTopicId}@${this.config.registrationState.accountId}`;
                    if (msg.operator_id === operatorId) continue;

                    console.log(
                        `[HOL-Chat] ${this.config.agentName} received message on ${topicId}: "${content.slice(0, 80)}..."`,
                    );

                    const response = await this.generateResponse(content);

                    await this.client.sendMessage(topicId, response);

                    console.log(
                        `[HOL-Chat] ${this.config.agentName} replied on ${topicId}`,
                    );
                }

                this.saveChatState();
            } catch (err: any) {
                if (!err.message?.includes("404")) {
                    console.error(
                        `[HOL-Chat] ${this.config.agentName} message handling error on ${topicId}: ${err.message}`,
                    );
                }
            }
        }
    }

    private async generateResponse(userMessage: string): Promise<string> {
        let agentContext = "";
        if (this.config.getAgentContext) {
            try {
                agentContext = await this.config.getAgentContext();
            } catch {
                agentContext = "Agent context unavailable.";
            }
        }

        const prompt = `
${this.config.personaPrompt}

You are chatting with a user or external agent via HCS-10 on the Hedera network.
You are part of the Ascend Intelligence Market — a decentralized platform where AI agents
compete by predicting HBAR/USD price movements. Your predictions are scored on-chain via
a CredScore system (confidence-weighted accuracy).

${agentContext ? `Current Agent State:\n${agentContext}\n` : ""}

Respond conversationally but stay in character. Be helpful and informative.
If asked about predictions, share your analytical approach without guaranteeing outcomes.
Keep responses concise (under 300 words).

User message: ${userMessage}
        `.trim();

        const schema = z.object({
            response: z.string().min(1).max(2000),
        });

        const candidates: Array<{ provider: "groq" | "gemini"; model: string }> = [];
        if (this.groq) {
            for (const model of [
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
                (process.env.GEMINI_CHAT_MODEL || "").trim(),
                "gemini-2.0-flash",
                "gemini-2.0-flash-lite",
                "gemini-1.5-flash",
            ]) {
                if (model) candidates.push({ provider: "gemini", model });
            }
        }

        const seen = new Set<string>();
        for (const candidate of candidates) {
            const key = `${candidate.provider}:${candidate.model}`;
            if (seen.has(key)) continue;
            seen.add(key);
            try {
                if (candidate.provider === "groq") {
                    const { text } = await generateText({
                        model: this.groq!(candidate.model),
                        prompt: `${prompt}

Respond with plain text only. Keep it under 300 words.
                        `.trim(),
                    });
                    const cleaned = text.trim();
                    if (cleaned.length === 0) {
                        throw new Error("Empty Groq response");
                    }
                    return cleaned.slice(0, 2000);
                } else {
                    const { object } = await generateObject({
                        model: this.gemini!(candidate.model),
                        schema,
                        prompt,
                    });
                    return object.response;
                }
            } catch (err: any) {
                console.warn(
                    `[HOL-Chat] ${this.config.agentName} model ${candidate.provider}/${candidate.model} unavailable: ${err?.message || String(err)}`,
                );
            }
        }

        return `I'm ${this.config.agentName} on Ascend. My LLM provider is temporarily unavailable, but I can still answer based on on-chain context shortly.`;
    }

    private loadChatState(): ChatState {
        if (fs.existsSync(this.stateFilePath)) {
            try {
                return JSON.parse(fs.readFileSync(this.stateFilePath, "utf-8"));
            } catch {
                // fall through
            }
        }
        return { connections: {}, lastInboundSeq: 0 };
    }

    private saveChatState(): void {
        const dir = path.dirname(this.stateFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.stateFilePath, JSON.stringify(this.chatState, null, 2));
    }
}
