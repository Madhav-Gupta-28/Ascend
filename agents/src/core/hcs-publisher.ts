/**
 * Ascend — HCS Publisher
 * 
 * Publishes prediction reasoning, round results, and discourse
 * to the single "ascend-rounds" HCS topic.
 * 
 * All messages go through the operator key (submitKey restricted topic).
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
    replyTo: number | null; // HCS sequence number, null for top-level
}

export type HCSMessage = ReasoningMessage | ResultMessage | DiscourseMessage;

// ── Publisher ──

export class HCSPublisher {
    private client: Client;
    private topicId: TopicId;

    constructor(operatorId: string, operatorKey: string, topicId: string, network: string = "testnet") {
        const client = network === "testnet" ? Client.forTestnet() : Client.forMainnet();
        client.setOperator(
            AccountId.fromString(operatorId),
            PrivateKey.fromStringED25519(operatorKey)
        );
        client.setDefaultMaxTransactionFee(new Hbar(5));

        this.client = client;
        this.topicId = TopicId.fromString(topicId);
    }

    /**
     * Publish a message to the ascend-rounds topic.
     * Message must be < 1024 bytes (HCS limit).
     */
    async publish(message: HCSMessage): Promise<{ sequenceNumber: number; timestamp: string }> {
        const json = JSON.stringify(message);
        const bytes = Buffer.byteLength(json, "utf-8");

        if (bytes > 1024) {
            throw new Error(`HCS message too large: ${bytes} bytes (max 1024). Truncate reasoning.`);
        }

        const tx = new TopicMessageSubmitTransaction()
            .setTopicId(this.topicId)
            .setMessage(json);

        const response = await tx.execute(this.client);
        const receipt = await response.getReceipt(this.client);

        return {
            sequenceNumber: Number(receipt.topicSequenceNumber),
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Publish agent reasoning during commit phase.
     * Reasoning is published BEFORE the reveal, so it must NOT contain the direction.
     * Wait — per our architecture, reasoning IS published with direction because
     * the prediction is already committed (hashed) on-chain. The reasoning explains
     * WHY, and the direction in the HCS message cannot change the on-chain commit.
     */
    async publishReasoning(
        roundId: number,
        agentId: string,
        direction: "UP" | "DOWN",
        confidence: number,
        reasoning: string
    ): Promise<{ sequenceNumber: number }> {
        // Truncate reasoning to stay under 1KB
        const maxReasoningLen = 600;
        const truncatedReasoning = reasoning.length > maxReasoningLen
            ? reasoning.substring(0, maxReasoningLen) + "..."
            : reasoning;

        const msg: ReasoningMessage = {
            type: "REASONING",
            roundId,
            agentId,
            direction,
            confidence,
            reasoning: truncatedReasoning,
        };

        return this.publish(msg);
    }

    /**
     * Publish round results after resolution.
     */
    async publishResult(
        roundId: number,
        startPrice: number,
        endPrice: number,
        outcome: "UP" | "DOWN",
        scores: ResultMessage["scores"]
    ): Promise<{ sequenceNumber: number }> {
        const msg: ResultMessage = {
            type: "RESULT",
            roundId,
            startPrice,
            endPrice,
            outcome,
            scores,
        };

        return this.publish(msg);
    }

    /**
     * Publish a discourse message.
     */
    async publishDiscourse(
        from: string,
        message: string,
        replyTo: number | null = null
    ): Promise<{ sequenceNumber: number }> {
        const msg: DiscourseMessage = {
            type: "DISCOURSE",
            from,
            message: message.substring(0, 700), // safety truncation
            replyTo,
        };

        return this.publish(msg);
    }

    close(): void {
        this.client.close();
    }
}

// ── Factory ──

export function createHCSPublisher(): HCSPublisher {
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    const topicId = process.env.ASCEND_ROUNDS_TOPIC_ID;
    const network = process.env.HEDERA_NETWORK || "testnet";

    if (!operatorId || !operatorKey || !topicId) {
        throw new Error("Missing HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, or ASCEND_ROUNDS_TOPIC_ID");
    }

    return new HCSPublisher(operatorId, operatorKey, topicId, network);
}
