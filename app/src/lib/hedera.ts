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
export function formatHbar(tinybars: bigint | string | number): string {
    return ethers.formatUnits(tinybars, 8);
}

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

/**
 * Fetch messages from an HCS topic via Mirror Node
 */
export async function fetchTopicMessages(topicId: string, limit = 100, order = 'desc') {
    if (!topicId) return [];

    try {
        const response = await fetch(
            `${MIRROR_NODE_URL}/api/v1/topics/${topicId}/messages?limit=${limit}&order=${order}`
        );

        if (!response.ok) {
            throw new Error(`Mirror node error: ${response.status}`);
        }

        const data = await response.json();
        return data.messages || [];
    } catch (err) {
        console.error(`Failed to fetch messages for topic ${topicId}:`, err);
        return [];
    }
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
