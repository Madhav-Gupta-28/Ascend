/**
 * Ascend — Mirror Node Client
 * 
 * Reads HCS messages and account data from the Hedera Mirror Node REST API.
 * Used by the frontend and the Oracle agent to read other agents' reasoning.
 */

export interface HCSMessageResponse {
    consensus_timestamp: string;
    topic_id: string;
    message: string;         // Base64 encoded
    sequence_number: number;
    payer_account_id: string;
}

export interface DecodedHCSMessage {
    sequenceNumber: number;
    consensusTimestamp: string;
    payerAccountId: string;
    data: any; // parsed JSON
}

export class MirrorNodeClient {
    private baseUrl: string;

    constructor(baseUrl?: string) {
        this.baseUrl = baseUrl || process.env.HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com";
    }

    private async fetchJSON(path: string): Promise<any> {
        const url = `${this.baseUrl}${path}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Mirror Node ${res.status}: ${url}`);
        return res.json();
    }

    /**
     * Get messages from an HCS topic, optionally filtered by time range
     */
    async getTopicMessages(
        topicId: string,
        options: {
            limit?: number;
            order?: "asc" | "desc";
            timestampGte?: string;
            timestampLte?: string;
            sequenceNumberGte?: number;
        } = {}
    ): Promise<DecodedHCSMessage[]> {
        const params = new URLSearchParams();
        params.set("limit", String(options.limit || 100));
        params.set("order", options.order || "desc");

        if (options.timestampGte) params.set("timestamp", `gte:${options.timestampGte}`);
        if (options.timestampLte) params.append("timestamp", `lte:${options.timestampLte}`);
        if (options.sequenceNumberGte) params.set("sequencenumber", `gte:${options.sequenceNumberGte}`);

        const data = await this.fetchJSON(`/api/v1/topics/${topicId}/messages?${params.toString()}`);

        return (data.messages || []).map((msg: HCSMessageResponse) => {
            let decoded: any;
            try {
                const raw = Buffer.from(msg.message, "base64").toString("utf-8");
                decoded = JSON.parse(raw);
            } catch {
                decoded = { raw: msg.message };
            }

            return {
                sequenceNumber: msg.sequence_number,
                consensusTimestamp: msg.consensus_timestamp,
                payerAccountId: msg.payer_account_id,
                data: decoded,
            };
        });
    }

    /**
     * Get reasoning messages for a specific round
     */
    async getRoundReasoning(topicId: string, roundId: number): Promise<DecodedHCSMessage[]> {
        const messages = await this.getTopicMessages(topicId, { limit: 100, order: "asc" });
        return messages.filter(
            (m) => m.data?.type === "REASONING" && m.data?.roundId === roundId
        );
    }

    /**
     * Get round result from HCS
     */
    async getRoundResult(topicId: string, roundId: number): Promise<DecodedHCSMessage | null> {
        const messages = await this.getTopicMessages(topicId, { limit: 100, order: "desc" });
        return messages.find(
            (m) => m.data?.type === "RESULT" && m.data?.roundId === roundId
        ) || null;
    }

    /**
     * Get account info from Mirror Node
     */
    async getAccountInfo(accountId: string): Promise<any> {
        return this.fetchJSON(`/api/v1/accounts/${accountId}`);
    }

    /**
     * Get token info from Mirror Node
     */
    async getTokenInfo(tokenId: string): Promise<any> {
        return this.fetchJSON(`/api/v1/tokens/${tokenId}`);
    }
}
