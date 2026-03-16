/**
 * Ascend — Hedera Network Configuration
 * 
 * Provides connections to Hedera's Hashio JSON-RPC for smart contract reads
 * and Hedera Mirror Node for HCS/HTS/Historical data.
 */

import { ethers } from "ethers";

// Fallback to testnet if not specified
export const HEDERA_NETWORK = process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet";

// ── Utility Functions (HBAR / Tinybar) ──
// Hedera contracts return HBAR-denominated balances in tinybar units (1 HBAR = 1e8 tinybar).
export function formatHbar(tinybars: bigint | string | number): string {
    return ethers.formatUnits(tinybars, 8);
}

// ContractExecuteTransaction#setPayableAmount expects tinybars.
export function parseHbar(hbarAmount: string): bigint {
    return ethers.parseUnits(hbarAmount, 8);
}

// ── JSON-RPC (EVM Smart Contracts) ──

export const HASHIO_RPC_URL = process.env.NEXT_PUBLIC_HEDERA_JSON_RPC || `https://${HEDERA_NETWORK}.hashio.io/api`;

// Singleton read-only provider for the frontend
let _provider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
    if (!_provider) {
        _provider = new ethers.JsonRpcProvider(HASHIO_RPC_URL);
    }
    return _provider;
}

// ── Mirror Node REST API ──

export const MIRROR_NODE_URL = process.env.NEXT_PUBLIC_HEDERA_MIRROR_NODE || `https://${HEDERA_NETWORK}.mirrornode.hedera.com`;

function normalizeMirrorNodeBase(baseUrl: string): string {
    const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!trimmed) return `https://${HEDERA_NETWORK}.mirrornode.hedera.com`;
    return trimmed.endsWith("/api/v1") ? trimmed.slice(0, -7) : trimmed;
}

const MIRROR_NODE_BASE = normalizeMirrorNodeBase(MIRROR_NODE_URL);

/**
 * Fetch messages from an HCS topic via Mirror Node
 */
export async function fetchTopicMessages(topicId: string, limit = 100, order = 'desc') {
    if (!topicId) return [];

    const safeTopicId = encodeURIComponent(topicId);
    const fallbackMirrorBase = `https://${HEDERA_NETWORK}.mirrornode.hedera.com`;

    const candidateUrls = [
        `${MIRROR_NODE_BASE}/api/v1/topics/${safeTopicId}/messages?limit=${limit}&order=${order}`,
        ...(typeof window !== "undefined"
            ? [`/api/mirror/topics/${safeTopicId}/messages?limit=${limit}&order=${order}`]
            : []),
        ...(MIRROR_NODE_BASE !== fallbackMirrorBase
            ? [`${fallbackMirrorBase}/api/v1/topics/${safeTopicId}/messages?limit=${limit}&order=${order}`]
            : []),
    ];

    for (const url of candidateUrls) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(10_000),
                cache: "no-store",
            });
            if (!response.ok) continue;
            const data = await response.json();
            if (Array.isArray(data?.messages)) {
                return data.messages;
            }
        } catch {
            // Move to next URL candidate quietly.
        }
    }

    return [];
}

/**
 * Convert HCS consensus timestamp (e.g. "1234567890.123456789") to ISO string
 */
export function consensusTimestampToIso(consensusTs: string): string {
    const [secondsRaw, nanosRaw = "0"] = consensusTs.split(".");
    const seconds = Number(secondsRaw);
    const nanos = Number(nanosRaw.padEnd(9, "0").slice(0, 9));
    const ms = seconds * 1000 + Math.floor(nanos / 1_000_000);
    return new Date(ms).toISOString();
}

/**
 * Utility to decode Base64 HCS message payloads and parse as JSON
 */
export function decodeBase64Json<T>(base64String: string): T | null {
    try {
        // Check if in browser or server
        const decoded = typeof window !== 'undefined'
            ? atob(base64String)
            : Buffer.from(base64String, 'base64').toString('utf8');

        // Handle potential duplicate decoding issues securely
        return JSON.parse(decoded) as T;
    } catch (err) {
        // Some messages might just be text, some might have failed JSON parsing
        return null;
    }
}
