import { useQuery } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { getProvider } from '@/lib/hedera';
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI } from '@/lib/contracts';
import { Agent } from '@/lib/types';

export function useAgents() {
    return useQuery({
        queryKey: ['agents'],
        queryFn: async (): Promise<Agent[]> => {
            const provider = getProvider();

            if (!CONTRACT_ADDRESSES.agentRegistry) {
                throw new Error("AgentRegistry address not configured");
            }

            const registry = new ethers.Contract(
                CONTRACT_ADDRESSES.agentRegistry,
                AGENT_REGISTRY_ABI,
                provider
            );

            // We need to know how many agents exist to fetch them
            // Alternatively, we could fetch events, but getAgentCount is cleaner
            try {
                const countBigInt = await registry.getAgentCount();
                const count = Number(countBigInt);

                if (count === 0) return [];

                // Fetch all agents in parallel
                const promises = [];
                for (let i = 1; i <= count; i++) {
                    promises.push(
                        registry
                            .getAgent(i)
                            .then((data: any) => ({
                                id: i,
                                owner: data.owner,
                                name: data.name,
                                description: data.description,
                                totalPredictions: Number(data.totalPredictions),
                                correctPredictions: Number(data.correctPredictions),
                                credScore: Number(data.credScore),
                                registrationBond: data.registrationBond, // Keep as bigint for wei display
                                totalStaked: data.totalStaked, // Keep as bigint for wei display
                                registeredAt: Number(data.registeredAt),
                                active: data.active,
                                accuracy:
                                    Number(data.totalPredictions) > 0
                                        ? (Number(data.correctPredictions) / Number(data.totalPredictions)) * 100
                                        : 0,
                            }))
                            .catch(() => null),
                    );
                }

                const agents = (await Promise.all(promises)).filter((agent): agent is Agent => agent !== null);

                // Return sorted by credScore descending as per architecture
                return agents.sort((a, b) => {
                    if (b.credScore !== a.credScore) {
                        return b.credScore - a.credScore;
                    }
                    return b.accuracy - a.accuracy; // Tiebreaker
                });

            } catch (err: any) {
                const text = String(err?.message || err || "");
                if (!/CALL_EXCEPTION|missing revert data/i.test(text)) {
                    console.error("Failed to fetch agents data:", err);
                }
                return [];
            }
        },
        refetchInterval: 30000, // Refresh every 30 seconds
    });
}

export function useAgent(agentId: number) {
    return useQuery({
        queryKey: ['agent', agentId],
        queryFn: async (): Promise<Agent | null> => {
            if (!agentId) return null;

            const provider = getProvider();

            if (!CONTRACT_ADDRESSES.agentRegistry) {
                throw new Error("AgentRegistry address not configured");
            }

            const registry = new ethers.Contract(
                CONTRACT_ADDRESSES.agentRegistry,
                AGENT_REGISTRY_ABI,
                provider
            );

            try {
                const count = Number(await registry.getAgentCount());
                if (!Number.isFinite(count) || agentId < 1 || agentId > count) {
                    return null;
                }
                const data = await registry.getAgent(agentId);

                return {
                    id: agentId,
                    owner: data.owner,
                    name: data.name,
                    description: data.description,
                    totalPredictions: Number(data.totalPredictions),
                    correctPredictions: Number(data.correctPredictions),
                    credScore: Number(data.credScore),
                    registrationBond: data.registrationBond,
                    totalStaked: data.totalStaked,
                    registeredAt: Number(data.registeredAt),
                    active: data.active,
                    accuracy: Number(data.totalPredictions) > 0
                        ? (Number(data.correctPredictions) / Number(data.totalPredictions)) * 100
                        : 0
                };
            } catch (err: any) {
                const text = String(err?.message || err || "");
                if (!/CALL_EXCEPTION|missing revert data/i.test(text)) {
                    console.error(`Failed to fetch agent ${agentId}:`, err);
                }
                return null;
            }
        },
        enabled: !!agentId,
        refetchInterval: 30000,
    });
}
