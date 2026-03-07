import { HCS10_PROTOCOL, HCS10_VERSION } from "./hcs10-types.js";

export type HCS10TopicKind = "inbound" | "outbound" | "connection";

export interface ParsedOperatorId {
    inboundTopicId: string;
    accountId: string;
}

export interface ParsedTopicMemo {
    protocol: string;
    version: number;
    topicKind: HCS10TopicKind;
    accountId: string;
}

export function buildOperatorId(inboundTopicId: string, accountId: string): string {
    return `${inboundTopicId}@${accountId}`;
}

export function parseOperatorId(operatorId: string): ParsedOperatorId | null {
    const [inboundTopicId, accountId] = operatorId.split("@");
    if (!inboundTopicId || !accountId) return null;
    return { inboundTopicId, accountId };
}

export function buildTopicMemo(topicKind: HCS10TopicKind, accountId: string): string {
    return `${HCS10_PROTOCOL}:${HCS10_VERSION}:${topicKind}:0:${accountId}`;
}

export function parseTopicMemo(memo: string): ParsedTopicMemo | null {
    const parts = memo.split(":");
    if (parts.length !== 5) return null;
    const [protocol, versionRaw, topicKindRaw, reserved, accountId] = parts;
    if (protocol !== HCS10_PROTOCOL) return null;
    if (Number(versionRaw) !== HCS10_VERSION) return null;
    if (reserved !== "0") return null;
    if (!accountId) return null;
    if (topicKindRaw !== "inbound" && topicKindRaw !== "outbound" && topicKindRaw !== "connection") {
        return null;
    }
    return {
        protocol,
        version: Number(versionRaw),
        topicKind: topicKindRaw,
        accountId,
    };
}

export function buildConnectionRequestTxMemo(requestorOperatorId: string, targetInboundTopicId: string): string {
    return `${HCS10_PROTOCOL}:${HCS10_VERSION}:${requestorOperatorId}:${targetInboundTopicId}`;
}

export function buildConnectionCreatedTxMemo(
    requesterOperatorId: string,
    responderOutboundTopicId: string,
    connectionTopicId: string,
): string {
    return `${HCS10_PROTOCOL}:${HCS10_VERSION}:${requesterOperatorId}:${responderOutboundTopicId}:${connectionTopicId}`;
}

export function buildConnectionAcceptedTxMemo(initialOperatorId: string, connectionTopicId: string): string {
    return `${HCS10_PROTOCOL}:${HCS10_VERSION}:${initialOperatorId}:${connectionTopicId}`;
}

export interface ParsedConnectionRequestTxMemo {
    requestorOperatorId: string;
    targetInboundTopicId: string;
}

export interface ParsedConnectionCreatedTxMemo {
    requesterOperatorId: string;
    responderOutboundTopicId: string;
    connectionTopicId: string;
}

export interface ParsedConnectionAcceptedTxMemo {
    initialOperatorId: string;
    connectionTopicId: string;
}

export function parseConnectionRequestTxMemo(memo: string): ParsedConnectionRequestTxMemo | null {
    const parts = memo.split(":");
    if (parts.length !== 4) return null;
    if (parts[0] !== HCS10_PROTOCOL || Number(parts[1]) !== HCS10_VERSION) return null;

    const requestorOperatorId = parts[2];
    const targetInboundTopicId = parts[3];
    if (!requestorOperatorId || !targetInboundTopicId) return null;

    return { requestorOperatorId, targetInboundTopicId };
}

export function parseConnectionCreatedTxMemo(memo: string): ParsedConnectionCreatedTxMemo | null {
    const parts = memo.split(":");
    if (parts.length !== 5) return null;
    if (parts[0] !== HCS10_PROTOCOL || Number(parts[1]) !== HCS10_VERSION) return null;

    const requesterOperatorId = parts[2];
    const responderOutboundTopicId = parts[3];
    const connectionTopicId = parts[4];
    if (!requesterOperatorId || !responderOutboundTopicId || !connectionTopicId) return null;

    return { requesterOperatorId, responderOutboundTopicId, connectionTopicId };
}

export function parseConnectionAcceptedTxMemo(memo: string): ParsedConnectionAcceptedTxMemo | null {
    const parts = memo.split(":");
    if (parts.length !== 4) return null;
    if (parts[0] !== HCS10_PROTOCOL || Number(parts[1]) !== HCS10_VERSION) return null;

    const initialOperatorId = parts[2];
    const connectionTopicId = parts[3];
    if (!initialOperatorId || !connectionTopicId) return null;

    return { initialOperatorId, connectionTopicId };
}
