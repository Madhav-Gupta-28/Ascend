export type HederaExplorerEntity = "account" | "contract" | "topic" | "transaction" | "address";

const HEDERA_ID_PATTERN = /^\d+\.\d+\.\d+$/;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const EVM_TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const HEDERA_TX_ID_DASH_PATTERN = /^\d+\.\d+\.\d+-\d+-\d+$/;
const HEDERA_TX_ID_AT_PATTERN = /^\d+\.\d+\.\d+@\d+\.\d+$/;

export function getHederaNetwork(): string {
    return process.env.NEXT_PUBLIC_HEDERA_NETWORK || process.env.HEDERA_NETWORK || "testnet";
}

export function isHederaId(value: string): boolean {
    return HEDERA_ID_PATTERN.test(String(value || "").trim());
}

export function isEvmAddress(value: string): boolean {
    return EVM_ADDRESS_PATTERN.test(String(value || "").trim());
}

export function isTransactionHash(value: string): boolean {
    return EVM_TX_HASH_PATTERN.test(String(value || "").trim());
}

export function isTransactionId(value: string): boolean {
    const trimmed = String(value || "").trim();
    return HEDERA_TX_ID_DASH_PATTERN.test(trimmed) || HEDERA_TX_ID_AT_PATTERN.test(trimmed);
}

export function normalizeTransactionId(value: string): string {
    const trimmed = String(value || "").trim();
    if (HEDERA_TX_ID_DASH_PATTERN.test(trimmed)) {
        const [entity, seconds, nanosRaw] = trimmed.split("-");
        const nanos = String(nanosRaw || "").padStart(9, "0").slice(0, 9);
        return `${entity}@${seconds}.${nanos}`;
    }
    if (HEDERA_TX_ID_AT_PATTERN.test(trimmed)) {
        const [entity, validStart] = trimmed.split("@");
        const [seconds, nanosRaw = "0"] = validStart.split(".");
        const nanos = String(nanosRaw || "").padEnd(9, "0").slice(0, 9);
        return `${entity}@${seconds}.${nanos}`;
    }
    return trimmed;
}

export function hashscanUrl(entity: HederaExplorerEntity, id: string, network = getHederaNetwork()): string {
    return `https://hashscan.io/${network}/${entity}/${encodeURIComponent(id)}`;
}

export function hashscanAccountUrl(accountId: string, network = getHederaNetwork()): string {
    return hashscanUrl("account", accountId, network);
}

export function hashscanContractUrl(contractId: string, network = getHederaNetwork()): string {
    return hashscanUrl("contract", contractId, network);
}

export function hashscanTopicUrl(topicId: string, network = getHederaNetwork()): string {
    return hashscanUrl("topic", topicId, network);
}

export function hashscanTransactionUrl(txIdOrHash: string, network = getHederaNetwork()): string {
    const trimmed = String(txIdOrHash || "").trim();
    if (isTransactionId(trimmed)) {
        const txId = normalizeTransactionId(trimmed);
        return `https://hashscan.io/${network}/tx/${encodeURIComponent(txId)}`;
    }
    return hashscanUrl("transaction", trimmed, network);
}

export function hashscanAddressUrl(address: string, network = getHederaNetwork()): string {
    return hashscanUrl("address", address, network);
}
