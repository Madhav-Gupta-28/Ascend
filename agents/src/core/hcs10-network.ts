import {
    AccountId,
    Client,
    Hbar,
    PrivateKey,
    TopicCreateTransaction,
    TopicId,
    TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { MirrorNodeClient } from "./mirror-node-client.js";
import {
    buildConnectionAcceptedTxMemo,
    buildConnectionCreatedTxMemo,
    buildConnectionRequestTxMemo,
    buildOperatorId,
    buildTopicMemo,
    parseOperatorId,
} from "./hcs10-memo.js";
import {
    ASCEND_HCS10_PROTOCOL,
    ASCEND_HCS10_VERSION,
    type AscendAgentMetadata,
    type AscendPayload,
    type ConnectionAcceptedOperation,
    type ConnectionCreatedOperation,
    type ConnectionRequestOperation,
    encodeAgentMetadata,
    encodeAscendPayload,
    HCS10_PROTOCOL,
    type HCS10Operation,
    parseAgentMetadata,
    parseAscendPayload,
    parseHCS10Operation,
    type QuestionAnswerPayload,
    type QuestionAskPayload,
    type ReasoningPublishPayload,
} from "./hcs10-types.js";

export interface HCS10NetworkConfig {
    network?: "testnet" | "mainnet";
    operatorAccountId: string;
    operatorPrivateKey: string;
    registryTopicId: string;
    agentId: string;
    agentName: string;
    capabilities?: string[];
    inboundTopicId?: string;
    outboundTopicId?: string;
    autoCreateTopics?: boolean;
    mirrorNodeBaseUrl?: string;
    stateFilePath?: string;
    maxMessagesPerFetch?: number;
}

interface TopicMessageRecord {
    topicId: string;
    sequenceNumber: number;
    consensusTimestamp: string;
    payerAccountId: string;
    data: unknown;
}

interface TopicCreateOptions {
    memo: string;
    restrictSubmit: boolean;
}

interface TopicSubmitOptions {
    topicId: string;
    message: string;
    txMemo?: string;
}

interface TopicFetchOptions {
    topicId: string;
    fromSequenceNumber: number;
    limit: number;
}

interface TopicTransport {
    createTopic(options: TopicCreateOptions): Promise<string>;
    submitMessage(options: TopicSubmitOptions): Promise<void>;
    fetchMessages(options: TopicFetchOptions): Promise<TopicMessageRecord[]>;
}

export interface ReasoningInboxItem {
    payload: ReasoningPublishPayload;
    connectionTopicId: string;
    peerOperatorId: string;
    sequenceNumber: number;
    consensusTimestamp: string;
}

export interface QuestionInboxItem {
    payload: QuestionAskPayload;
    connectionTopicId: string;
    peerOperatorId: string;
    sequenceNumber: number;
    consensusTimestamp: string;
}

export interface AnswerInboxItem {
    payload: QuestionAnswerPayload;
    connectionTopicId: string;
    peerOperatorId: string;
    sequenceNumber: number;
    consensusTimestamp: string;
}

interface PeerDirectoryEntry {
    operatorId: string;
    accountId: string;
    inboundTopicId: string;
    outboundTopicId: string;
    agentId: string;
    agentName: string;
    capabilities: string[];
}

type ConnectionStatus = "requested" | "created" | "active" | "closed";

interface ConnectionEntry {
    peerOperatorId: string;
    peerAccountId: string;
    peerAgentId: string;
    peerAgentName: string;
    peerOutboundTopicId?: string;
    requestId: string;
    status: ConnectionStatus;
    connectionTopicId?: string;
    updatedAt: number;
}

interface HCS10NetworkState {
    inboundTopicId: string;
    outboundTopicId: string;
    operatorId: string;
    registered: boolean;
    peers: Record<string, PeerDirectoryEntry>;
    connections: Record<string, ConnectionEntry>;
    cursors: Record<string, number>;
}

const DEFAULT_FETCH_LIMIT = 100;

function parseHederaPrivateKey(privateKey: string): PrivateKey {
    const normalized = privateKey.trim();
    // Prefer explicit key-type parsers first; generic fromString() can mis-parse raw hex ECDSA keys.
    try {
        return PrivateKey.fromStringECDSA(normalized);
    } catch {
        try {
            return PrivateKey.fromStringED25519(normalized);
        } catch {
            try {
                return PrivateKey.fromString(normalized);
            } catch {
                throw new Error(
                    "Invalid HCS-10 private key format. Provide a Hedera ED25519 or ECDSA key string.",
                );
            }
        }
    }
}

class HederaTopicTransport implements TopicTransport {
    private readonly client: Client;
    private readonly operatorKey: PrivateKey;
    private readonly mirrorNodeClient: MirrorNodeClient;

    constructor(
        network: "testnet" | "mainnet",
        operatorAccountId: string,
        operatorPrivateKey: string,
        mirrorNodeBaseUrl?: string,
    ) {
        const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
        const accountId = AccountId.fromString(operatorAccountId);
        const privateKey = parseHederaPrivateKey(operatorPrivateKey);

        client.setOperator(accountId, privateKey);
        client.setDefaultMaxTransactionFee(new Hbar(5));
        this.client = client;
        this.operatorKey = privateKey;
        this.mirrorNodeClient = new MirrorNodeClient(mirrorNodeBaseUrl);
    }

    async createTopic(options: TopicCreateOptions): Promise<string> {
        const tx = new TopicCreateTransaction()
            .setTopicMemo(options.memo)
            .setAdminKey(this.operatorKey.publicKey);

        if (options.restrictSubmit) {
            tx.setSubmitKey(this.operatorKey.publicKey);
        }

        const response = await tx.execute(this.client);
        const receipt = await response.getReceipt(this.client);
        if (!receipt.topicId) {
            throw new Error("Topic creation failed: missing topic id in receipt");
        }

        return receipt.topicId.toString();
    }

    async submitMessage(options: TopicSubmitOptions): Promise<void> {
        const tx = new TopicMessageSubmitTransaction()
            .setTopicId(TopicId.fromString(options.topicId))
            .setMessage(options.message);

        if (options.txMemo) {
            tx.setTransactionMemo(options.txMemo);
        }

        const response = await tx.execute(this.client);
        await response.getReceipt(this.client);
    }

    async fetchMessages(options: TopicFetchOptions): Promise<TopicMessageRecord[]> {
        const decoded = await this.mirrorNodeClient.getTopicMessages(options.topicId, {
            limit: options.limit,
            order: "asc",
            sequenceNumberGte: options.fromSequenceNumber,
        });

        return decoded.map((message) => ({
            topicId: options.topicId,
            sequenceNumber: message.sequenceNumber,
            consensusTimestamp: message.consensusTimestamp,
            payerAccountId: message.payerAccountId,
            data: message.data,
        }));
    }
}

export class HCS10CommunicationNetwork {
    private readonly config: Required<
        Pick<
            HCS10NetworkConfig,
            "network" | "capabilities" | "autoCreateTopics" | "maxMessagesPerFetch"
        >
    > &
        Omit<HCS10NetworkConfig, "network" | "capabilities" | "autoCreateTopics" | "maxMessagesPerFetch">;
    private readonly stateFilePath: string;
    private readonly transport: TopicTransport;
    private state: HCS10NetworkState;
    private bootstrapped = false;
    private readonly processedMessageIds = new Set<string>();
    private readonly reasoningInbox: ReasoningInboxItem[] = [];
    private readonly questionInbox: QuestionInboxItem[] = [];
    private readonly answerInbox: AnswerInboxItem[] = [];

    constructor(config: HCS10NetworkConfig, transport?: TopicTransport) {
        this.config = {
            network: config.network ?? "testnet",
            capabilities: config.capabilities ?? ["reasoning", "qa"],
            autoCreateTopics: config.autoCreateTopics ?? true,
            maxMessagesPerFetch: config.maxMessagesPerFetch ?? DEFAULT_FETCH_LIMIT,
            ...config,
        };

        this.stateFilePath =
            config.stateFilePath ??
            path.resolve(process.cwd(), `.cache/hcs10_${this.config.agentId.toLowerCase()}_state.json`);
        this.state = this.loadState();
        this.transport =
            transport ??
            new HederaTopicTransport(
                this.config.network,
                this.config.operatorAccountId,
                this.config.operatorPrivateKey,
                this.config.mirrorNodeBaseUrl,
            );
    }

    getIdentity(): {
        operatorId: string;
        inboundTopicId: string;
        outboundTopicId: string;
    } {
        return {
            operatorId: this.state.operatorId,
            inboundTopicId: this.state.inboundTopicId,
            outboundTopicId: this.state.outboundTopicId,
        };
    }

    getActiveConnections(): ConnectionEntry[] {
        return Object.values(this.state.connections).filter(
            (connection) => connection.status === "active" && Boolean(connection.connectionTopicId),
        );
    }

    async bootstrap(): Promise<void> {
        if (this.bootstrapped) return;

        if (!this.state.inboundTopicId || !this.state.outboundTopicId) {
            if (this.config.inboundTopicId && this.config.outboundTopicId) {
                this.state.inboundTopicId = this.config.inboundTopicId;
                this.state.outboundTopicId = this.config.outboundTopicId;
            } else if (this.config.autoCreateTopics) {
                this.state.inboundTopicId = await this.transport.createTopic({
                    memo: buildTopicMemo("inbound", this.config.operatorAccountId),
                    restrictSubmit: false,
                });
                this.state.outboundTopicId = await this.transport.createTopic({
                    memo: buildTopicMemo("outbound", this.config.operatorAccountId),
                    restrictSubmit: true,
                });
            } else {
                throw new Error(
                    "HCS-10 inbound/outbound topics are required when autoCreateTopics=false",
                );
            }
        }

        this.state.operatorId = buildOperatorId(
            this.state.inboundTopicId,
            this.config.operatorAccountId,
        );

        if (!this.state.registered) {
            await this.registerAgentIdentity();
            this.state.registered = true;
        }

        this.saveState();
        this.bootstrapped = true;
    }

    async sync(): Promise<void> {
        await this.bootstrap();
        await this.discoverPeers();
        await this.ensureConnections();
        await this.handleInboundConnectionRequests();
        await this.handlePeerOutboundMessages();
        await this.handleConnectionTopics();
        this.saveState();
    }

    async publishReasoning(
        roundId: number,
        commitHash: string,
        confidence: number,
        reasoning: string,
    ): Promise<number> {
        await this.bootstrap();

        const payload: ReasoningPublishPayload = {
            protocol: ASCEND_HCS10_PROTOCOL,
            version: ASCEND_HCS10_VERSION,
            kind: "reasoning.publish",
            messageId: randomUUID(),
            timestamp: Date.now(),
            fromAgentId: this.config.agentId,
            fromAgentName: this.config.agentName,
            roundId,
            commitHash,
            confidence,
            reasoning: reasoning.length > 1100 ? `${reasoning.slice(0, 1100)}...` : reasoning,
        };

        return this.broadcastPayload(payload, "reasoning.publish");
    }

    async sendAnswer(
        connectionTopicId: string,
        questionId: string,
        answer: string,
        confidence?: number,
    ): Promise<void> {
        await this.bootstrap();

        const payload: QuestionAnswerPayload = {
            protocol: ASCEND_HCS10_PROTOCOL,
            version: ASCEND_HCS10_VERSION,
            kind: "question.answer",
            messageId: randomUUID(),
            timestamp: Date.now(),
            fromAgentId: this.config.agentId,
            fromAgentName: this.config.agentName,
            correlationId: questionId,
            questionId,
            answer: answer.length > 1700 ? `${answer.slice(0, 1700)}...` : answer,
            confidence,
        };

        await this.sendPayloadToTopic(connectionTopicId, payload, "question.answer");
    }

    drainReasoningInbox(roundId?: number): ReasoningInboxItem[] {
        const drained = this.reasoningInbox.splice(0, this.reasoningInbox.length);
        if (roundId === undefined) return drained;
        return drained.filter((item) => item.payload.roundId === roundId);
    }

    drainQuestionInbox(): QuestionInboxItem[] {
        return this.questionInbox.splice(0, this.questionInbox.length);
    }

    drainAnswerInbox(): AnswerInboxItem[] {
        return this.answerInbox.splice(0, this.answerInbox.length);
    }

    getReasoningContext(roundId: number, limit = 8): string {
        const items = this.reasoningInbox
            .filter((item) => item.payload.roundId === roundId)
            .slice(-limit);

        if (items.length === 0) return "No peer reasoning received for this round yet.";

        return items
            .map((item) => {
                const p = item.payload;
                return `[${p.fromAgentName}] confidence=${p.confidence}% commit=${p.commitHash.slice(0, 10)}... reasoning="${p.reasoning}"`;
            })
            .join("\n");
    }

    private async registerAgentIdentity(): Promise<void> {
        const metadata: AscendAgentMetadata = {
            app: "ascend",
            name: this.config.agentName,
            agentId: this.config.agentId,
            inboundTopicId: this.state.inboundTopicId,
            outboundTopicId: this.state.outboundTopicId,
            capabilities: this.config.capabilities,
        };

        const message = JSON.stringify({
            p: HCS10_PROTOCOL,
            op: "register",
            account_id: this.config.operatorAccountId,
            m: encodeAgentMetadata(metadata),
        });

        await this.transport.submitMessage({
            topicId: this.config.registryTopicId,
            message,
        });
    }

    private async discoverPeers(): Promise<void> {
        const cursor = this.state.cursors[this.config.registryTopicId] ?? 0;
        // If no peers are cached, replay from the beginning to recover from stale cursors.
        const from = Object.keys(this.state.peers).length === 0 && cursor > 0 ? 1 : cursor + 1;
        const messages = await this.transport.fetchMessages({
            topicId: this.config.registryTopicId,
            fromSequenceNumber: from,
            limit: this.config.maxMessagesPerFetch,
        });

        if (messages.length === 0) return;

        for (const message of messages) {
            const operation = parseHCS10Operation(message.data);
            if (operation) {
                if (operation.op === "register") {
                    this.upsertPeer(operation);
                } else if (operation.op === "delete") {
                    this.removePeer(operation.account_id);
                }
            }

            this.state.cursors[this.config.registryTopicId] = Math.max(
                this.state.cursors[this.config.registryTopicId] ?? 0,
                message.sequenceNumber,
            );
        }
    }

    private upsertPeer(operation: HCS10Operation): void {
        if (operation.op !== "register") return;

        const metadata = parseAgentMetadata(operation.m);
        if (!metadata) return;

        const operatorId = buildOperatorId(metadata.inboundTopicId, operation.account_id);
        // In demo mode multiple agents can share one account with different inbound topics.
        // Only skip an exact self-identity, not every registration from the same account id.
        if (operatorId === this.state.operatorId) return;

        this.state.peers[operatorId] = {
            operatorId,
            accountId: operation.account_id,
            inboundTopicId: metadata.inboundTopicId,
            outboundTopicId: metadata.outboundTopicId,
            agentId: metadata.agentId,
            agentName: metadata.name,
            capabilities: metadata.capabilities,
        };
    }

    private removePeer(accountId: string): void {
        for (const [operatorId, peer] of Object.entries(this.state.peers)) {
            if (peer.accountId === accountId) {
                delete this.state.peers[operatorId];
                this.state.connections[operatorId] = {
                    ...this.state.connections[operatorId],
                    status: "closed",
                };
            }
        }
    }

    private async ensureConnections(): Promise<void> {
        for (const peer of Object.values(this.state.peers)) {
            if (peer.operatorId === this.state.operatorId) continue;

            const connection = this.state.connections[peer.operatorId];
            if (connection && connection.status !== "closed") continue;

            const requestId = randomUUID();
            const request: ConnectionRequestOperation = {
                p: HCS10_PROTOCOL,
                op: "connection_request",
                operator_id: this.state.operatorId,
                connection_request_id: requestId,
                m: "ascend:reasoning+qa",
            };

            await this.transport.submitMessage({
                topicId: peer.inboundTopicId,
                message: JSON.stringify(request),
                txMemo: buildConnectionRequestTxMemo(this.state.operatorId, peer.inboundTopicId),
            });

            this.state.connections[peer.operatorId] = {
                peerOperatorId: peer.operatorId,
                peerAccountId: peer.accountId,
                peerAgentId: peer.agentId,
                peerAgentName: peer.agentName,
                peerOutboundTopicId: peer.outboundTopicId,
                requestId,
                status: "requested",
                updatedAt: Date.now(),
            };
        }
    }

    private async handleInboundConnectionRequests(): Promise<void> {
        const topicId = this.state.inboundTopicId;
        const from = (this.state.cursors[topicId] ?? 0) + 1;
        const messages = await this.transport.fetchMessages({
            topicId,
            fromSequenceNumber: from,
            limit: this.config.maxMessagesPerFetch,
        });

        for (const message of messages) {
            const operation = parseHCS10Operation(message.data);
            if (operation?.op === "connection_request") {
                await this.acceptConnectionRequest(operation);
            }

            this.state.cursors[topicId] = Math.max(
                this.state.cursors[topicId] ?? 0,
                message.sequenceNumber,
            );
        }
    }

    private async acceptConnectionRequest(operation: ConnectionRequestOperation): Promise<void> {
        if (operation.operator_id === this.state.operatorId) return;

        const requestId = operation.connection_request_id ?? randomUUID();
        const peerParts = parseOperatorId(operation.operator_id);
        if (!peerParts) return;

        const existing = this.state.connections[operation.operator_id];
        if (existing && existing.status !== "closed") {
            if (existing.status !== "requested") return;
            const shouldRespondToSimultaneousRequest = this.state.operatorId < operation.operator_id;
            if (!shouldRespondToSimultaneousRequest) return;
        }

        const connectionTopicId = await this.transport.createTopic({
            memo: buildTopicMemo("connection", this.config.operatorAccountId),
            restrictSubmit: false,
        });

        const created: ConnectionCreatedOperation = {
            p: HCS10_PROTOCOL,
            op: "connection_created",
            operator_id: this.state.operatorId,
            connection_topic_id: connectionTopicId,
            connection_request_id: requestId,
            m: "ascend:connection",
        };

        await this.transport.submitMessage({
            topicId: this.state.outboundTopicId,
            message: JSON.stringify(created),
            txMemo: buildConnectionCreatedTxMemo(
                operation.operator_id,
                this.state.outboundTopicId,
                connectionTopicId,
            ),
        });

        const peer = this.state.peers[operation.operator_id];
        this.state.connections[operation.operator_id] = {
            ...(existing ?? {}),
            peerOperatorId: operation.operator_id,
            peerAccountId: existing?.peerAccountId ?? peer?.accountId ?? peerParts.accountId,
            peerAgentId: existing?.peerAgentId ?? peer?.agentId ?? peerParts.accountId,
            peerAgentName: existing?.peerAgentName ?? peer?.agentName ?? `peer-${peerParts.accountId}`,
            peerOutboundTopicId: existing?.peerOutboundTopicId ?? peer?.outboundTopicId,
            requestId,
            status: "created",
            connectionTopicId,
            updatedAt: Date.now(),
        };
    }

    private async handlePeerOutboundMessages(): Promise<void> {
        for (const peer of Object.values(this.state.peers)) {
            const from = (this.state.cursors[peer.outboundTopicId] ?? 0) + 1;
            const messages = await this.transport.fetchMessages({
                topicId: peer.outboundTopicId,
                fromSequenceNumber: from,
                limit: this.config.maxMessagesPerFetch,
            });

            for (const message of messages) {
                const operation = parseHCS10Operation(message.data);
                if (operation?.op === "connection_created") {
                    await this.handleConnectionCreated(peer.operatorId, operation);
                }

                this.state.cursors[peer.outboundTopicId] = Math.max(
                    this.state.cursors[peer.outboundTopicId] ?? 0,
                    message.sequenceNumber,
                );
            }
        }
    }

    private async handleConnectionCreated(
        peerOperatorId: string,
        operation: ConnectionCreatedOperation,
    ): Promise<void> {
        const connection = this.state.connections[peerOperatorId];
        if (!connection) return;
        if (connection.status !== "requested") return;
        if (
            operation.connection_request_id &&
            connection.requestId !== operation.connection_request_id
        ) {
            return;
        }

        const accepted: ConnectionAcceptedOperation = {
            p: HCS10_PROTOCOL,
            op: "connection_accepted",
            operator_id: this.state.operatorId,
            connection_topic_id: operation.connection_topic_id,
            connection_request_id: connection.requestId,
            m: "ascend:accepted",
        };

        await this.transport.submitMessage({
            topicId: operation.connection_topic_id,
            message: JSON.stringify(accepted),
            txMemo: buildConnectionAcceptedTxMemo(peerOperatorId, operation.connection_topic_id),
        });

        this.state.connections[peerOperatorId] = {
            ...connection,
            connectionTopicId: operation.connection_topic_id,
            status: "active",
            updatedAt: Date.now(),
        };
    }

    private async handleConnectionTopics(): Promise<void> {
        const activeLike = Object.values(this.state.connections).filter(
            (connection) => connection.connectionTopicId && connection.status !== "closed",
        );

        for (const connection of activeLike) {
            const topicId = connection.connectionTopicId!;
            const from = (this.state.cursors[topicId] ?? 0) + 1;
            const messages = await this.transport.fetchMessages({
                topicId,
                fromSequenceNumber: from,
                limit: this.config.maxMessagesPerFetch,
            });

            for (const message of messages) {
                const operation = parseHCS10Operation(message.data);
                if (!operation) {
                    this.advanceCursor(topicId, message.sequenceNumber);
                    continue;
                }

                if (operation.op === "connection_accepted") {
                    this.state.connections[connection.peerOperatorId] = {
                        ...connection,
                        status: "active",
                        updatedAt: Date.now(),
                    };
                } else if (operation.op === "close_connection") {
                    this.state.connections[connection.peerOperatorId] = {
                        ...connection,
                        status: "closed",
                        updatedAt: Date.now(),
                    };
                } else if (operation.op === "message") {
                    this.handleMessageOperation(connection, operation, message);
                }

                this.advanceCursor(topicId, message.sequenceNumber);
            }
        }
    }

    private handleMessageOperation(
        connection: ConnectionEntry,
        operation: Extract<HCS10Operation, { op: "message" }>,
        message: TopicMessageRecord,
    ): void {
        const payload = parseAscendPayload(operation.data);
        if (!payload) return;
        if (this.processedMessageIds.has(payload.messageId)) return;
        this.processedMessageIds.add(payload.messageId);

        if (payload.kind === "reasoning.publish") {
            this.reasoningInbox.push({
                payload,
                connectionTopicId: connection.connectionTopicId!,
                peerOperatorId: connection.peerOperatorId,
                sequenceNumber: message.sequenceNumber,
                consensusTimestamp: message.consensusTimestamp,
            });
            return;
        }

        if (payload.kind === "question.ask") {
            const target = payload.targetAgentId;
            if (target && target !== this.config.agentId) return;
            this.questionInbox.push({
                payload,
                connectionTopicId: connection.connectionTopicId!,
                peerOperatorId: connection.peerOperatorId,
                sequenceNumber: message.sequenceNumber,
                consensusTimestamp: message.consensusTimestamp,
            });
            return;
        }

        if (payload.kind === "question.answer") {
            this.answerInbox.push({
                payload,
                connectionTopicId: connection.connectionTopicId!,
                peerOperatorId: connection.peerOperatorId,
                sequenceNumber: message.sequenceNumber,
                consensusTimestamp: message.consensusTimestamp,
            });
        }
    }

    private async broadcastPayload(payload: AscendPayload, memoKind: string): Promise<number> {
        const activeConnections = this.getActiveConnections();
        for (const connection of activeConnections) {
            await this.sendPayloadToTopic(connection.connectionTopicId!, payload, memoKind);
        }
        return activeConnections.length;
    }

    private async sendPayloadToTopic(topicId: string, payload: AscendPayload, memoKind: string): Promise<void> {
        const op = {
            p: HCS10_PROTOCOL,
            op: "message",
            operator_id: this.state.operatorId,
            data: encodeAscendPayload(payload),
            m: `ascend:${memoKind}`,
        };

        await this.transport.submitMessage({
            topicId,
            message: JSON.stringify(op),
        });
    }

    private advanceCursor(topicId: string, sequenceNumber: number): void {
        this.state.cursors[topicId] = Math.max(this.state.cursors[topicId] ?? 0, sequenceNumber);
    }

    private loadState(): HCS10NetworkState {
        if (fs.existsSync(this.stateFilePath)) {
            try {
                const raw = fs.readFileSync(this.stateFilePath, "utf-8");
                const parsed = JSON.parse(raw) as Partial<HCS10NetworkState>;
                return {
                    inboundTopicId: parsed.inboundTopicId ?? "",
                    outboundTopicId: parsed.outboundTopicId ?? "",
                    operatorId: parsed.operatorId ?? "",
                    registered: Boolean(parsed.registered),
                    peers: parsed.peers ?? {},
                    connections: parsed.connections ?? {},
                    cursors: parsed.cursors ?? {},
                };
            } catch {
                return this.emptyState();
            }
        }

        return this.emptyState();
    }

    private emptyState(): HCS10NetworkState {
        return {
            inboundTopicId: "",
            outboundTopicId: "",
            operatorId: "",
            registered: false,
            peers: {},
            connections: {},
            cursors: {},
        };
    }

    private saveState(): void {
        const dir = path.dirname(this.stateFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
    }
}
