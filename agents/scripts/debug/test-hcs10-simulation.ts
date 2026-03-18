import { randomUUID } from "node:crypto";
import * as fs from "node:fs";

import { HCS10CommunicationNetwork } from "../src/core/hcs10-network.js";
import { ASCEND_HCS10_PROTOCOL, ASCEND_HCS10_VERSION } from "../src/core/hcs10-types.js";

interface TopicMessageRecord {
    topicId: string;
    sequenceNumber: number;
    consensusTimestamp: string;
    payerAccountId: string;
    data: unknown;
}

class InMemoryTopicTransport {
    private topics = new Map<string, TopicMessageRecord[]>();
    private nextTopicNum = 9000;

    async createTopic(): Promise<string> {
        const topicId = `0.0.${this.nextTopicNum++}`;
        this.topics.set(topicId, []);
        return topicId;
    }

    async submitMessage(options: { topicId: string; message: string }): Promise<void> {
        const stream = this.topics.get(options.topicId);
        if (!stream) throw new Error(`Unknown topic: ${options.topicId}`);

        let data: unknown = options.message;
        try {
            data = JSON.parse(options.message);
        } catch {
            data = options.message;
        }

        stream.push({
            topicId: options.topicId,
            sequenceNumber: stream.length + 1,
            consensusTimestamp: new Date().toISOString(),
            payerAccountId: "0.0.9999",
            data,
        });
    }

    async fetchMessages(options: {
        topicId: string;
        fromSequenceNumber: number;
        limit: number;
    }): Promise<TopicMessageRecord[]> {
        const stream = this.topics.get(options.topicId) ?? [];
        return stream
            .filter((item) => item.sequenceNumber >= options.fromSequenceNumber)
            .slice(0, options.limit);
    }

    async getTopicData(topicId: string): Promise<TopicMessageRecord[]> {
        return this.topics.get(topicId) ?? [];
    }
}

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

async function runSimulation(): Promise<void> {
    const transport = new InMemoryTopicTransport();
    const registryTopicId = await transport.createTopic();
    const sentinelStateFile = "/tmp/hcs10_sim_sentinel.json";
    const oracleStateFile = "/tmp/hcs10_sim_oracle.json";
    if (fs.existsSync(sentinelStateFile)) fs.unlinkSync(sentinelStateFile);
    if (fs.existsSync(oracleStateFile)) fs.unlinkSync(oracleStateFile);

    const sentinel = new HCS10CommunicationNetwork(
        {
            network: "testnet",
            operatorAccountId: "0.0.1001",
            operatorPrivateKey: "302e020100300506032b6570042204200000000000000000000000000000000000000000000000000000000000000001",
            registryTopicId,
            agentId: "1",
            agentName: "Sentinel",
            stateFilePath: sentinelStateFile,
        },
        transport as never,
    );

    const oracle = new HCS10CommunicationNetwork(
        {
            network: "testnet",
            operatorAccountId: "0.0.1002",
            operatorPrivateKey: "302e020100300506032b6570042204200000000000000000000000000000000000000000000000000000000000000002",
            registryTopicId,
            agentId: "4",
            agentName: "Oracle",
            stateFilePath: oracleStateFile,
        },
        transport as never,
    );

    await sentinel.bootstrap();
    await oracle.bootstrap();

    // Multiple sync passes to let request/create/accept converge.
    for (let i = 0; i < 4; i++) {
        await sentinel.sync();
        await oracle.sync();
    }

    const sentinelConnections = sentinel.getActiveConnections();
    const oracleConnections = oracle.getActiveConnections();
    assert(sentinelConnections.length > 0, "sentinel should have an active connection");
    assert(oracleConnections.length > 0, "oracle should have an active connection");

    await sentinel.publishReasoning(
        42,
        "0x1111111111111111111111111111111111111111111111111111111111111111",
        73,
        "RSI compression and rising volume suggest directional expansion.",
    );

    await oracle.sync();
    const peerReasoning = oracle.drainReasoningInbox(42);
    assert(peerReasoning.length > 0, "oracle should receive sentinel reasoning");

    const connectionTopicId = oracleConnections[0].connectionTopicId!;
    const questionId = `q-${randomUUID()}`;
    await transport.submitMessage({
        topicId: connectionTopicId,
        message: JSON.stringify({
            p: "hcs-10",
            op: "message",
            operator_id: "0.0.8000@0.0.7000",
            data: JSON.stringify({
                protocol: ASCEND_HCS10_PROTOCOL,
                version: ASCEND_HCS10_VERSION,
                kind: "question.ask",
                messageId: randomUUID(),
                timestamp: Date.now(),
                fromAgentId: "user",
                fromAgentName: "User",
                questionId,
                question: "Why are you leaning bullish this round?",
                targetAgentId: "4",
            }),
            m: "ascend:question.ask",
        }),
    });

    await oracle.sync();
    const questions = oracle.drainQuestionInbox();
    assert(questions.length === 1, "oracle should receive one user question");

    await oracle.sendAnswer(
        connectionTopicId,
        questionId,
        "Momentum and volatility contraction support upside probability in this setup.",
        79,
    );

    const allConnectionMessages = await transport.getTopicData(connectionTopicId);
    const answerOperation = allConnectionMessages
        .map((entry) => entry.data as any)
        .find((entry) => entry?.op === "message" && typeof entry?.data === "string" && entry.data.includes("\"kind\":\"question.answer\""));

    assert(Boolean(answerOperation), "connection topic should contain question.answer payload");

    console.log("✅ HCS-10 simulation passed");
    console.log(`   Registry topic: ${registryTopicId}`);
    console.log(`   Connection topic: ${connectionTopicId}`);
}

runSimulation().catch((error) => {
    console.error("❌ HCS-10 simulation failed");
    console.error(error);
    process.exit(1);
});
