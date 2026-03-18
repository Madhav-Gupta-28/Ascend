import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { getProvider } from "@/lib/hedera";
import { AGENT_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";

const REGISTRATION_LOG_LOOKBACK_BLOCKS = 25_000;

async function fetchRegistrationTxForAgent(agentId: number): Promise<string | null> {
    if (!Number.isFinite(agentId) || agentId <= 0) return null;
    if (!CONTRACT_ADDRESSES.agentRegistry) return null;

    try {
        const provider = getProvider();
        const registry = new ethers.Contract(
            CONTRACT_ADDRESSES.agentRegistry,
            AGENT_REGISTRY_ABI,
            provider,
        );

        const latestBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, latestBlock - REGISTRATION_LOG_LOOKBACK_BLOCKS);
        const logs = await registry.queryFilter(
            registry.filters.AgentRegistered(BigInt(agentId)),
            fromBlock,
            "latest",
        );
        if (logs.length === 0) return null;

        const latestLog = logs[logs.length - 1];
        const txHash = String((latestLog as any).transactionHash || "").trim();
        return txHash.length > 0 ? txHash : null;
    } catch {
        return null;
    }
}

export function useAgentRegistrationProof(agentId: number) {
    return useQuery({
        queryKey: ["agent-registration-proof", agentId],
        queryFn: () => fetchRegistrationTxForAgent(agentId),
        enabled: Number.isFinite(agentId) && agentId > 0 && Boolean(CONTRACT_ADDRESSES.agentRegistry),
        refetchInterval: 30_000,
    });
}

export function useAgentRegistrationProofs(agentIds: number[]) {
    const normalizedIds = useMemo(
        () =>
            Array.from(
                new Set(
                    agentIds
                        .map((id) => Number(id))
                        .filter((id) => Number.isFinite(id) && id > 0),
                ),
            ).sort((a, b) => a - b),
        [agentIds],
    );

    return useQuery({
        queryKey: ["agent-registration-proofs", normalizedIds],
        queryFn: async (): Promise<Record<number, string>> => {
            if (normalizedIds.length === 0 || !CONTRACT_ADDRESSES.agentRegistry) return {};

            const pairs = await Promise.all(
                normalizedIds.map(async (agentId) => {
                    const txHash = await fetchRegistrationTxForAgent(agentId);
                    return [agentId, txHash] as const;
                }),
            );

            const map: Record<number, string> = {};
            for (const [agentId, txHash] of pairs) {
                if (txHash) map[agentId] = txHash;
            }
            return map;
        },
        enabled: normalizedIds.length > 0 && Boolean(CONTRACT_ADDRESSES.agentRegistry),
        refetchInterval: 30_000,
    });
}
