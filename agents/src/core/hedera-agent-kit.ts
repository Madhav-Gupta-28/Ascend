import { Client, AccountId, PrivateKey } from "@hashgraph/sdk";
import {
    AgentMode,
    HederaLangchainToolkit,
    coreAccountPluginToolNames,
    coreAccountQueryPluginToolNames,
    coreConsensusPluginToolNames,
    coreConsensusQueryPluginToolNames,
    coreTokenPluginToolNames,
    coreTokenQueryPluginToolNames,
} from "hedera-agent-kit";

export const DEFAULT_HEDERA_AGENT_KIT_TOOLS = [
    coreAccountQueryPluginToolNames.GET_HBAR_BALANCE_QUERY_TOOL,
    coreAccountQueryPluginToolNames.GET_ACCOUNT_QUERY_TOOL,
    coreAccountPluginToolNames.CREATE_ACCOUNT_TOOL,
    coreConsensusPluginToolNames.CREATE_TOPIC_TOOL,
    coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL,
    coreConsensusQueryPluginToolNames.GET_TOPIC_MESSAGES_QUERY_TOOL,
    coreTokenPluginToolNames.ASSOCIATE_TOKEN_TOOL,
    coreTokenQueryPluginToolNames.GET_TOKEN_INFO_QUERY_TOOL,
] as const;

export interface HederaAgentKitConfig {
    network: "testnet" | "mainnet";
    operatorAccountId: string;
    operatorPrivateKey: string;
    mode?: AgentMode;
    tools?: readonly string[];
}

export interface HederaAgentKitResult {
    raw?: any;
    humanMessage?: string;
}

function parseHederaPrivateKey(raw: string): PrivateKey {
    try {
        return PrivateKey.fromString(raw);
    } catch {
        try {
            return PrivateKey.fromStringED25519(raw);
        } catch {
            return PrivateKey.fromStringECDSA(raw);
        }
    }
}

function parseResult(payload: string): HederaAgentKitResult {
    try {
        return JSON.parse(payload) as HederaAgentKitResult;
    } catch {
        return { humanMessage: payload };
    }
}

export class HederaAgentKitClient {
    private readonly client: Client;
    private readonly toolkit: HederaLangchainToolkit;
    private readonly methods: Set<string>;

    constructor(config: HederaAgentKitConfig) {
        this.client =
            config.network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
        this.client.setOperator(
            AccountId.fromString(config.operatorAccountId),
            parseHederaPrivateKey(config.operatorPrivateKey),
        );

        this.toolkit = new HederaLangchainToolkit({
            client: this.client,
            configuration: {
                tools: [...(config.tools || DEFAULT_HEDERA_AGENT_KIT_TOOLS)],
                context: {
                    mode: config.mode ?? AgentMode.AUTONOMOUS,
                    accountId: config.operatorAccountId,
                },
            },
        });

        this.methods = new Set(this.toolkit.getTools().map((tool) => tool.method));
    }

    getEnabledMethods(): string[] {
        return Array.from(this.methods.values()).sort();
    }

    private async run(method: string, params: Record<string, unknown>): Promise<HederaAgentKitResult> {
        if (!this.methods.has(method)) {
            throw new Error(
                `Hedera Agent Kit method not enabled: ${method}. Enabled: ${this.getEnabledMethods().join(", ")}`,
            );
        }

        const api = this.toolkit.getHederaAgentKitAPI();
        const result = await api.run(method, params);
        return parseResult(result);
    }

    async getHbarBalance(accountId?: string): Promise<HederaAgentKitResult> {
        return this.run(coreAccountQueryPluginToolNames.GET_HBAR_BALANCE_QUERY_TOOL, {
            ...(accountId ? { accountId } : {}),
        });
    }

    async getTopicMessages(topicId: string, limit: number = 20): Promise<HederaAgentKitResult> {
        return this.run(coreConsensusQueryPluginToolNames.GET_TOPIC_MESSAGES_QUERY_TOOL, {
            topicId,
            limit,
        });
    }

    async submitTopicMessage(
        topicId: string,
        message: string,
        transactionMemo?: string,
    ): Promise<HederaAgentKitResult> {
        return this.run(coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL, {
            topicId,
            message,
            ...(transactionMemo ? { transactionMemo } : {}),
        });
    }

    async associateToken(accountId: string, tokenId: string): Promise<HederaAgentKitResult> {
        return this.run(coreTokenPluginToolNames.ASSOCIATE_TOKEN_TOOL, {
            accountId,
            tokenIds: [tokenId],
        });
    }

    async createAccount(initialBalance: number = 2): Promise<HederaAgentKitResult> {
        return this.run(coreAccountPluginToolNames.CREATE_ACCOUNT_TOOL, {
            initialBalance,
        });
    }

    close(): void {
        this.client.close();
    }
}

export function createHederaAgentKitFromEnv(): HederaAgentKitClient {
    const network =
        (process.env.HEDERA_NETWORK as "testnet" | "mainnet" | undefined) ?? "testnet";
    const operatorAccountId = process.env.HEDERA_OPERATOR_ID;
    const operatorPrivateKey = process.env.HEDERA_OPERATOR_KEY;

    if (!operatorAccountId || !operatorPrivateKey) {
        throw new Error("Missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY for Hedera Agent Kit");
    }

    return new HederaAgentKitClient({
        network,
        operatorAccountId,
        operatorPrivateKey,
    });
}
