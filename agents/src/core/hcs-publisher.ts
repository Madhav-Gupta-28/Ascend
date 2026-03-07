/**
 * Ascend — HCS Publisher
 *
 * Architecture-aligned routing:
 * - `ascend-predictions` topic for REASONING
 * - `ascend-results` topic for RESULT
 * - per-agent discourse topics for DISCOURSE
 */

import {
    Client,
    AccountId,
    PrivateKey,
    TopicId,
    TopicMessageSubmitTransaction,
    Hbar,
} from "@hashgraph/sdk";

// ── Message Types ──

export interface ReasoningMessage {
    type: "REASONING";
    roundId: number;
    agentId: string;
    direction: "UP" | "DOWN";
    confidence: number;
    reasoning: string;
}

export interface ResultMessage {
    type: "RESULT";
    roundId: number;
    startPrice: number;
    endPrice: number;
    outcome: "UP" | "DOWN";
    scores: Array<{
        agentId: string;
        correct: boolean;
        credScoreDelta: number;
    }>;
}

export interface DiscourseMessage {
    type: "DISCOURSE";
    from: string;
    message: string;
    replyTo: number | null;
}

export type HCSMessage = ReasoningMessage | ResultMessage | DiscourseMessage;

export interface HCSTopicConfig {
    predictionsTopicId: string;
    resultsTopicId: string;
    discourseTopics: Record<string, string>;
    defaultDiscourseTopicId?: string;
}

function normalizeAgentTopicKey(input: string): string {
    const value = input.trim().toLowerCase();
    if (value === "1" || value.includes("sentinel")) return "sentinel";
    if (value === "2" || value.includes("pulse")) return "pulse";
    if (value === "3" || value.includes("meridian")) return "meridian";
    if (value === "4" || value.includes("oracle")) return "oracle";
    return value;
}

function parseDiscourseTopicsFromEnv(): Record<string, string> {
    const topics: Record<string, string> = {};

    const rawJson = process.env.ASCEND_DISCOURSE_TOPICS_JSON;
    if (rawJson) {
        try {
            const parsed = JSON.parse(rawJson) as Record<string, string>;
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value.trim())) {
                    topics[normalizeAgentTopicKey(key)] = value.trim();
                }
            }
        } catch {
            // ignore malformed json and fall back to explicit env vars
        }
    }

    const explicitMap: Array<[string, string | undefined]> = [
        ["sentinel", process.env.ASCEND_DISCOURSE_SENTINEL_TOPIC_ID],
        ["pulse", process.env.ASCEND_DISCOURSE_PULSE_TOPIC_ID],
        ["meridian", process.env.ASCEND_DISCOURSE_MERIDIAN_TOPIC_ID],
        ["oracle", process.env.ASCEND_DISCOURSE_ORACLE_TOPIC_ID],
    ];

    for (const [key, value] of explicitMap) {
        if (value && /^\d+\.\d+\.\d+$/.test(value.trim())) {
            topics[key] = value.trim();
        }
    }

    return topics;
}

export class HCSPublisher {
    private readonly client: Client;
    private readonly predictionsTopicId: TopicId;
    private readonly resultsTopicId: TopicId;
    private readonly discourseTopics: Record<string, TopicId>;
    private readonly defaultDiscourseTopicId: TopicId | null;

    constructor(
        operatorId: string,
        operatorKey: string,
        topics: HCSTopicConfig,
        network: string = "testnet",
    ) {
        const client = network === "testnet" ? Client.forTestnet() : Client.forMainnet();
        client.setOperator(
            AccountId.fromString(operatorId),
            PrivateKey.fromStringED25519(operatorKey),
        );
        client.setDefaultMaxTransactionFee(new Hbar(5));

        this.client = client;
        this.predictionsTopicId = TopicId.fromString(topics.predictionsTopicId);
        this.resultsTopicId = TopicId.fromString(topics.resultsTopicId);

        this.discourseTopics = Object.fromEntries(
            Object.entries(topics.discourseTopics).map(([key, topicId]) => [
                normalizeAgentTopicKey(key),
                TopicId.fromString(topicId),
            ]),
        );

        this.defaultDiscourseTopicId = topics.defaultDiscourseTopicId
            ? TopicId.fromString(topics.defaultDiscourseTopicId)
            : null;
    }

    private async publishToTopic(
        topicId: TopicId,
        message: HCSMessage,
    ): Promise<{ sequenceNumber: number; timestamp: string }> {
        const json = JSON.stringify(message);
        const bytes = Buffer.byteLength(json, "utf-8");

        if (bytes > 1024) {
            throw new Error(`HCS message too large: ${bytes} bytes (max 1024)`);
        }

        const tx = new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(json);
        const response = await tx.execute(this.client);
        const receipt = await response.getReceipt(this.client);

        return {
            sequenceNumber: Number(receipt.topicSequenceNumber),
            timestamp: new Date().toISOString(),
        };
    }

    async publishReasoning(
        roundId: number,
        agentId: string,
        direction: "UP" | "DOWN",
        confidence: number,
        reasoning: string,
    ): Promise<{ sequenceNumber: number }> {
        const maxReasoningLen = 600;
        const truncatedReasoning =
            reasoning.length > maxReasoningLen
                ? `${reasoning.substring(0, maxReasoningLen)}...`
                : reasoning;

        const msg: ReasoningMessage = {
            type: "REASONING",
            roundId,
            agentId,
            direction,
            confidence,
            reasoning: truncatedReasoning,
        };

        return this.publishToTopic(this.predictionsTopicId, msg);
    }

    async publishResult(
        roundId: number,
        startPrice: number,
        endPrice: number,
        outcome: "UP" | "DOWN",
        scores: ResultMessage["scores"],
    ): Promise<{ sequenceNumber: number }> {
        const msg: ResultMessage = {
            type: "RESULT",
            roundId,
            startPrice,
            endPrice,
            outcome,
            scores,
        };

        return this.publishToTopic(this.resultsTopicId, msg);
    }

    async publishDiscourse(
        from: string,
        message: string,
        replyTo: number | null = null,
    ): Promise<{ sequenceNumber: number }> {
        const msg: DiscourseMessage = {
            type: "DISCOURSE",
            from,
            message: message.substring(0, 700),
            replyTo,
        };

        const key = normalizeAgentTopicKey(from);
        const topic =
            this.discourseTopics[key] ||
            this.defaultDiscourseTopicId ||
            Object.values(this.discourseTopics)[0] ||
            null;

        if (!topic) {
            throw new Error(
                `No discourse topic configured for agent '${from}'. Set ASCEND_DISCOURSE_TOPICS_JSON or ASCEND_DISCOURSE_*_TOPIC_ID.`,
            );
        }

        return this.publishToTopic(topic, msg);
    }

    close(): void {
        this.client.close();
    }
}

export function createHCSPublisher(): HCSPublisher {
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    const network = process.env.HEDERA_NETWORK || "testnet";

    let predictionsTopicId = process.env.ASCEND_PREDICTIONS_TOPIC_ID;
    let resultsTopicId = process.env.ASCEND_RESULTS_TOPIC_ID;

    // Backward compatibility for legacy single-topic deployments.
    const legacyRoundTopicId = process.env.ASCEND_ROUNDS_TOPIC_ID;
    if (!predictionsTopicId && legacyRoundTopicId) predictionsTopicId = legacyRoundTopicId;
    if (!resultsTopicId && legacyRoundTopicId) resultsTopicId = legacyRoundTopicId;

    const discourseTopics = parseDiscourseTopicsFromEnv();
    const defaultDiscourseTopicId = legacyRoundTopicId || undefined;

    if (!operatorId || !operatorKey || !predictionsTopicId || !resultsTopicId) {
        throw new Error(
            "Missing HCS publisher env: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, ASCEND_PREDICTIONS_TOPIC_ID, ASCEND_RESULTS_TOPIC_ID",
        );
    }

    return new HCSPublisher(
        operatorId,
        operatorKey,
        {
            predictionsTopicId,
            resultsTopicId,
            discourseTopics,
            defaultDiscourseTopicId,
        },
        network,
    );
}
