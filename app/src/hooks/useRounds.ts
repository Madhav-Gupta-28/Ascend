import { useQuery } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { getProvider } from '@/lib/hedera';
import { CONTRACT_ADDRESSES, PREDICTION_MARKET_ABI } from '@/lib/contracts';
import { Round, Commitment } from '@/lib/types';

export function useCurrentRound() {
    return useQuery({
        queryKey: ['currentRound'],
        queryFn: async (): Promise<Round | null> => {
            const provider = getProvider();

            if (!CONTRACT_ADDRESSES.predictionMarket) {
                throw new Error("PredictionMarket address not configured");
            }

            const market = new ethers.Contract(
                CONTRACT_ADDRESSES.predictionMarket,
                PREDICTION_MARKET_ABI,
                provider
            );

            try {
                const roundCount = await market.getRoundCount();
                const count = Number(roundCount);

                if (count === 0) return null;

                // Fetch the latest round
                const data = await market.getRound(count);

                return {
                    id: count,
                    startPrice: Number(data.startPrice) / 1e8, // Convert from Hashio 8 decimals
                    endPrice: Number(data.endPrice) / 1e8,
                    commitDeadline: Number(data.commitDeadline),
                    revealDeadline: Number(data.revealDeadline),
                    resolveAfter: Number(data.resolveAfter),
                    entryFee: data.entryFee,
                    status: Number(data.status) as 0 | 1 | 2 | 3, // 0=Committing, 1=Revealing, 2=Resolved, 3=Cancelled
                    outcome: Number(data.outcome) as 0 | 1,
                    participantCount: Number(data.participantCount),
                    revealedCount: Number(data.revealedCount)
                };
            } catch (err) {
                console.error("Failed to fetch current round:", err);
                throw err;
            }
        },
        refetchInterval: (query) => {
            const state = query.state.data as Round | null;
            // Keep polling at low frequency even after resolution so the UI can discover the next round.
            if (state?.status === 2 || state?.status === 3) return 15000;
            return (state?.status === 0 || state?.status === 1) ? 5000 : 15000;
        },
    });
}

export function useRound(roundId: number) {
    return useQuery({
        queryKey: ['round', roundId],
        queryFn: async (): Promise<Round | null> => {
            if (!roundId) return null;

            const provider = getProvider();
            const market = new ethers.Contract(
                CONTRACT_ADDRESSES.predictionMarket,
                PREDICTION_MARKET_ABI,
                provider
            );

            try {
                const data = await market.getRound(roundId);

                return {
                    id: roundId,
                    startPrice: Number(data.startPrice) / 1e8,
                    endPrice: Number(data.endPrice) / 1e8,
                    commitDeadline: Number(data.commitDeadline),
                    revealDeadline: Number(data.revealDeadline),
                    resolveAfter: Number(data.resolveAfter),
                    entryFee: data.entryFee,
                    status: Number(data.status) as 0 | 1 | 2 | 3,
                    outcome: Number(data.outcome) as 0 | 1,
                    participantCount: Number(data.participantCount),
                    revealedCount: Number(data.revealedCount)
                };
            } catch (err) {
                console.error(`Failed to fetch round ${roundId}:`, err);
                throw err;
            }
        },
        enabled: !!roundId,
        refetchInterval: (query) => {
            const state = query.state.data as Round | null;
            return state?.status === 2 ? false : 15000;
        }, // Stop polling if resolved
    });
}

export function useCommitments(roundId: number, agentIds: number[], roundStatus?: number) {
    return useQuery({
        queryKey: ['commitments', roundId, agentIds],
        queryFn: async (): Promise<Record<number, Commitment>> => {
            if (!roundId || !agentIds?.length) return {};

            const provider = getProvider();
            const market = new ethers.Contract(
                CONTRACT_ADDRESSES.predictionMarket,
                PREDICTION_MARKET_ABI,
                provider
            );

            const commitments: Record<number, Commitment> = {};

            try {
                const promises = agentIds.map(agentId =>
                    market.getCommitment(roundId, agentId).then((data: any) => {
                        commitments[agentId] = {
                            committed: data.committed,
                            revealed: data.revealed,
                            scored: data.scored,
                            direction: (Number(data.direction) === 0 || Number(data.direction) === 1 ? Number(data.direction) : 0) as 0 | 1,
                            confidence: Number(data.confidence)
                        };
                    }).catch(err => console.warn(`Error getting commitment for agent ${agentId}:`, err))
                );

                await Promise.all(promises);
                return commitments;
            } catch (err) {
                console.error(`Failed to fetch commitments for round ${roundId}:`, err);
                return {};
            }
        },
        enabled: !!roundId && agentIds.length > 0,
        refetchInterval: (roundStatus === 0 || roundStatus === 1) ? 5000 : 15000,
    });
}
