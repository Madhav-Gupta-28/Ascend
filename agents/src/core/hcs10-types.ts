import { z } from "zod";

export const HCS10_PROTOCOL = "hcs-10" as const;
export const HCS10_VERSION = 0 as const;

export type HCS10OperationName =
    | "register"
    | "delete"
    | "connection_request"
    | "connection_created"
    | "connection_accepted"
    | "message"
    | "close_connection";

const AccountIdSchema = z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "account_id must be Hedera account format x.y.z");

const TopicIdSchema = z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "topic id must be Hedera topic format x.y.z");

const OperatorIdSchema = z
    .string()
    .regex(/^\d+\.\d+\.\d+@\d+\.\d+\.\d+$/, "operator_id must be inboundTopicId@accountId");

const BaseOperationSchema = z.object({
    p: z.literal(HCS10_PROTOCOL),
    op: z.string(),
    m: z.string().optional(),
});

export const RegisterOperationSchema = BaseOperationSchema.extend({
    op: z.literal("register"),
    account_id: AccountIdSchema,
});

export const DeleteOperationSchema = BaseOperationSchema.extend({
    op: z.literal("delete"),
    account_id: AccountIdSchema,
});

export const ConnectionRequestOperationSchema = BaseOperationSchema.extend({
    op: z.literal("connection_request"),
    operator_id: OperatorIdSchema,
    connection_request_id: z.string().min(1).optional(),
    sequence_number: z.number().int().positive().optional(),
});

export const ConnectionCreatedOperationSchema = BaseOperationSchema.extend({
    op: z.literal("connection_created"),
    operator_id: OperatorIdSchema,
    connection_topic_id: TopicIdSchema,
    connection_request_id: z.string().min(1).optional(),
});

export const ConnectionAcceptedOperationSchema = BaseOperationSchema.extend({
    op: z.literal("connection_accepted"),
    operator_id: OperatorIdSchema,
    connection_topic_id: TopicIdSchema,
    connection_request_id: z.string().min(1).optional(),
});

export const MessageOperationSchema = BaseOperationSchema.extend({
    op: z.literal("message"),
    operator_id: OperatorIdSchema,
    data: z.string(),
});

export const CloseConnectionOperationSchema = BaseOperationSchema.extend({
    op: z.literal("close_connection"),
    operator_id: OperatorIdSchema,
    connection_topic_id: TopicIdSchema,
    reason: z.string().optional(),
});

export const HCS10OperationSchema = z.discriminatedUnion("op", [
    RegisterOperationSchema,
    DeleteOperationSchema,
    ConnectionRequestOperationSchema,
    ConnectionCreatedOperationSchema,
    ConnectionAcceptedOperationSchema,
    MessageOperationSchema,
    CloseConnectionOperationSchema,
]);

export type RegisterOperation = z.infer<typeof RegisterOperationSchema>;
export type DeleteOperation = z.infer<typeof DeleteOperationSchema>;
export type ConnectionRequestOperation = z.infer<typeof ConnectionRequestOperationSchema>;
export type ConnectionCreatedOperation = z.infer<typeof ConnectionCreatedOperationSchema>;
export type ConnectionAcceptedOperation = z.infer<typeof ConnectionAcceptedOperationSchema>;
export type MessageOperation = z.infer<typeof MessageOperationSchema>;
export type CloseConnectionOperation = z.infer<typeof CloseConnectionOperationSchema>;
export type HCS10Operation = z.infer<typeof HCS10OperationSchema>;

export function parseHCS10Operation(input: unknown): HCS10Operation | null {
    const result = HCS10OperationSchema.safeParse(input);
    return result.success ? result.data : null;
}

export const ASCEND_HCS10_PROTOCOL = "ascend-hcs10" as const;
export const ASCEND_HCS10_VERSION = "1.0.0" as const;

const BaseAscendPayloadSchema = z.object({
    protocol: z.literal(ASCEND_HCS10_PROTOCOL),
    version: z.literal(ASCEND_HCS10_VERSION),
    kind: z.string(),
    messageId: z.string().min(8),
    timestamp: z.number().int().positive(),
    fromAgentId: z.string().min(1),
    fromAgentName: z.string().min(1),
    correlationId: z.string().min(1).optional(),
});

export const ReasoningPublishPayloadSchema = BaseAscendPayloadSchema.extend({
    kind: z.literal("reasoning.publish"),
    roundId: z.number().int().positive(),
    commitHash: z
        .string()
        .regex(/^0x[a-fA-F0-9]{64}$/, "commitHash must be hex keccak256 hash"),
    confidence: z.number().min(0).max(100),
    reasoning: z.string().min(1).max(1200),
});

export const QuestionAskPayloadSchema = BaseAscendPayloadSchema.extend({
    kind: z.literal("question.ask"),
    questionId: z.string().min(1),
    question: z.string().min(1).max(1200),
    targetAgentId: z.string().min(1).optional(),
});

export const QuestionAnswerPayloadSchema = BaseAscendPayloadSchema.extend({
    kind: z.literal("question.answer"),
    questionId: z.string().min(1),
    answer: z.string().min(1).max(1800),
    confidence: z.number().min(0).max(100).optional(),
});

export const AscendPayloadSchema = z.discriminatedUnion("kind", [
    ReasoningPublishPayloadSchema,
    QuestionAskPayloadSchema,
    QuestionAnswerPayloadSchema,
]);

export type ReasoningPublishPayload = z.infer<typeof ReasoningPublishPayloadSchema>;
export type QuestionAskPayload = z.infer<typeof QuestionAskPayloadSchema>;
export type QuestionAnswerPayload = z.infer<typeof QuestionAnswerPayloadSchema>;
export type AscendPayload = z.infer<typeof AscendPayloadSchema>;

export function encodeAscendPayload(payload: AscendPayload): string {
    return JSON.stringify(payload);
}

export function parseAscendPayload(input: unknown): AscendPayload | null {
    if (typeof input === "string") {
        try {
            const parsed = JSON.parse(input);
            const result = AscendPayloadSchema.safeParse(parsed);
            return result.success ? result.data : null;
        } catch {
            return null;
        }
    }

    const result = AscendPayloadSchema.safeParse(input);
    return result.success ? result.data : null;
}

export interface AscendAgentMetadata {
    app: "ascend";
    name: string;
    agentId: string;
    inboundTopicId: string;
    outboundTopicId: string;
    capabilities: string[];
}

export function encodeAgentMetadata(metadata: AscendAgentMetadata): string {
    return JSON.stringify(metadata);
}

export function parseAgentMetadata(raw?: string): AscendAgentMetadata | null {
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (
            parsed?.app === "ascend" &&
            typeof parsed?.name === "string" &&
            typeof parsed?.agentId === "string" &&
            typeof parsed?.inboundTopicId === "string" &&
            typeof parsed?.outboundTopicId === "string" &&
            Array.isArray(parsed?.capabilities)
        ) {
            return parsed as AscendAgentMetadata;
        }
        return null;
    } catch {
        return null;
    }
}
