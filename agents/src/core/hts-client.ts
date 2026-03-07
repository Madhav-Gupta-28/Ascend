import {
    AccountBalanceQuery,
    AccountId,
    Client,
    Hbar,
    PrivateKey,
    TokenAssociateTransaction,
    TokenId,
    TokenInfoQuery,
    TransferTransaction,
} from "@hashgraph/sdk";

export interface HtsTokenInfo {
    tokenId: string;
    symbol: string;
    name: string;
    decimals: number;
}

export interface RewardRecipient {
    accountId: string;
    amountTinyUnits: bigint;
}

function parseHederaPrivateKey(privateKey: string): PrivateKey {
    try {
        return PrivateKey.fromString(privateKey);
    } catch {
        try {
            return PrivateKey.fromStringED25519(privateKey);
        } catch {
            return PrivateKey.fromStringECDSA(privateKey);
        }
    }
}

function safeBigIntToNumber(value: bigint): number {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    if (value > max || value < min) {
        throw new Error(
            `Token transfer amount ${value.toString()} is outside JS safe integer range`,
        );
    }
    return Number(value);
}

function parseDecimalAmountToTinyUnits(amount: string | number, decimals: number): bigint {
    const raw = String(amount).trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) {
        throw new Error(`Invalid decimal token amount: ${raw}`);
    }

    const [wholePart, fracPart = ""] = raw.split(".");
    const normalizedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
    const tinyString = `${wholePart}${normalizedFrac}`.replace(/^0+(?=\d)/, "");
    return BigInt(tinyString || "0");
}

function formatTinyUnitsToDecimal(amountTinyUnits: bigint, decimals: number): string {
    const negative = amountTinyUnits < 0n;
    const abs = negative ? -amountTinyUnits : amountTinyUnits;
    const s = abs.toString().padStart(decimals + 1, "0");
    const whole = s.slice(0, -decimals) || "0";
    const frac = s.slice(-decimals).replace(/0+$/, "");
    const rendered = frac.length > 0 ? `${whole}.${frac}` : whole;
    return negative ? `-${rendered}` : rendered;
}

export class HTSClient {
    private readonly client: Client;
    private readonly tokenId: TokenId;
    private readonly tokenIdString: string;
    private tokenInfoCache: HtsTokenInfo | null = null;

    constructor(
        network: "testnet" | "mainnet",
        operatorAccountId: string,
        operatorPrivateKey: string,
        tokenId: string,
    ) {
        this.client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
        this.client.setOperator(
            AccountId.fromString(operatorAccountId),
            parseHederaPrivateKey(operatorPrivateKey),
        );
        this.client.setDefaultMaxTransactionFee(new Hbar(10));
        this.tokenId = TokenId.fromString(tokenId);
        this.tokenIdString = tokenId;
    }

    async getTokenInfo(forceRefresh = false): Promise<HtsTokenInfo> {
        if (!forceRefresh && this.tokenInfoCache) {
            return this.tokenInfoCache;
        }

        const info = await new TokenInfoQuery().setTokenId(this.tokenId).execute(this.client);
        const tokenInfo: HtsTokenInfo = {
            tokenId: this.tokenIdString,
            symbol: info.symbol ?? "",
            name: info.name ?? "",
            decimals: info.decimals,
        };
        this.tokenInfoCache = tokenInfo;
        return tokenInfo;
    }

    async getTokenBalance(accountId: string): Promise<bigint> {
        const query = await new AccountBalanceQuery()
            .setAccountId(AccountId.fromString(accountId))
            .execute(this.client);

        const tokensAny = query.tokens as any;
        if (!tokensAny) return 0n;

        // SDK v2+ map-like accessor
        if (typeof tokensAny.get === "function") {
            const value = tokensAny.get(this.tokenId);
            if (value == null) return 0n;
            return BigInt(value.toString());
        }

        // Fallback shapes in older SDK responses
        const raw =
            tokensAny?.[this.tokenIdString] ??
            tokensAny?._map?.[this.tokenIdString] ??
            tokensAny?._map?.get?.(this.tokenIdString);
        if (raw == null) return 0n;
        return BigInt(raw.toString());
    }

    async associateToken(accountId: string, accountPrivateKey: string): Promise<{
        success: boolean;
        status: string;
    }> {
        try {
            const tx = new TokenAssociateTransaction()
                .setAccountId(AccountId.fromString(accountId))
                .setTokenIds([this.tokenId])
                .freezeWith(this.client);

            const signed = await tx.sign(parseHederaPrivateKey(accountPrivateKey));
            const response = await signed.execute(this.client);
            const receipt = await response.getReceipt(this.client);

            return { success: true, status: receipt.status.toString() };
        } catch (error: any) {
            const msg = error?.status?.toString?.() || error?.message || String(error);
            if (msg.includes("TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT")) {
                return { success: true, status: "TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT" };
            }
            return { success: false, status: msg };
        }
    }

    async transferToken(recipients: RewardRecipient[]): Promise<{
        status: string;
        totalTinyUnits: bigint;
    }> {
        if (recipients.length === 0) {
            return { status: "NO_RECIPIENTS", totalTinyUnits: 0n };
        }

        const total = recipients.reduce((sum, r) => sum + r.amountTinyUnits, 0n);
        if (total <= 0n) {
            throw new Error("Total token transfer amount must be positive");
        }

        const operatorAccountId = this.client.operatorAccountId;
        if (!operatorAccountId) {
            throw new Error("HTS client missing operator account id");
        }

        const tx = new TransferTransaction();
        tx.addTokenTransfer(
            this.tokenId,
            operatorAccountId,
            safeBigIntToNumber(-total),
        );
        for (const recipient of recipients) {
            if (recipient.amountTinyUnits <= 0n) continue;
            tx.addTokenTransfer(
                this.tokenId,
                AccountId.fromString(recipient.accountId),
                safeBigIntToNumber(recipient.amountTinyUnits),
            );
        }

        const response = await tx.execute(this.client);
        const receipt = await response.getReceipt(this.client);
        return { status: receipt.status.toString(), totalTinyUnits: total };
    }

    async rewardAccountsEqual(accountIds: string[], amountPerAccountTokens: string | number): Promise<{
        status: string;
        totalTinyUnits: bigint;
        perAccountTinyUnits: bigint;
    }> {
        if (accountIds.length === 0) {
            return {
                status: "NO_RECIPIENTS",
                totalTinyUnits: 0n,
                perAccountTinyUnits: 0n,
            };
        }

        const tokenInfo = await this.getTokenInfo();
        const perAccountTinyUnits = parseDecimalAmountToTinyUnits(
            amountPerAccountTokens,
            tokenInfo.decimals,
        );
        if (perAccountTinyUnits <= 0n) {
            return {
                status: "ZERO_REWARD",
                totalTinyUnits: 0n,
                perAccountTinyUnits,
            };
        }

        const transfer = await this.transferToken(
            accountIds.map((accountId) => ({
                accountId,
                amountTinyUnits: perAccountTinyUnits,
            })),
        );

        return {
            status: transfer.status,
            totalTinyUnits: transfer.totalTinyUnits,
            perAccountTinyUnits,
        };
    }

    toTinyUnits(amountTokens: string | number, decimals: number): bigint {
        return parseDecimalAmountToTinyUnits(amountTokens, decimals);
    }

    formatTinyUnits(amountTinyUnits: bigint, decimals: number): string {
        return formatTinyUnitsToDecimal(amountTinyUnits, decimals);
    }

    close(): void {
        this.client.close();
    }
}

export function createHTSClient(): HTSClient {
    const network =
        (process.env.HEDERA_NETWORK as "testnet" | "mainnet" | undefined) ?? "testnet";
    const operatorAccountId = process.env.HEDERA_OPERATOR_ID;
    const operatorPrivateKey = process.env.HEDERA_OPERATOR_KEY;
    const tokenId = process.env.ASCEND_TOKEN_ID;

    if (!operatorAccountId || !operatorPrivateKey || !tokenId) {
        throw new Error(
            "Missing HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, or ASCEND_TOKEN_ID",
        );
    }

    return new HTSClient(network, operatorAccountId, operatorPrivateKey, tokenId);
}
