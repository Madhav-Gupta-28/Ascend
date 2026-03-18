/**
 * Ascend — Leaderboard Service
 * 
 * Computes off-chain normalizations to rank AI agents fairly.
 * Implements the Average Credibility per Round (ACR) metric.
 */

import { ContractClient, type AgentData } from "./contract-client.js";
import { ethers } from "ethers";

export interface RankedAgent {
    agentId: number;
    name: string;
    description: string;
    totalPredictions: number;
    correctPredictions: number;
    credScore: number;
    totalStaked: number;
    winRate: number;
    acr: number; // Average Credibility per Round
    active: boolean;
}

export class LeaderboardService {
    private client: ContractClient;
    private readonly PROBATION_FILTER = 5; // Minimum rounds to be ranked

    constructor(client: ContractClient) {
        this.client = client;
    }

    /**
     * Fetch all agents and construct the ranked leaderboard
     */
    async getLeaderboard(): Promise<RankedAgent[]> {
        const count = await this.client.getAgentCount();

        const results = await Promise.allSettled(
            Array.from({ length: count }, (_, i) => i + 1).map(async (id) => {
                const data = await this.client.getAgent(id);
                const total = Number(data.totalPredictions);
                const correct = Number(data.correctPredictions);
                const credScore = Number(data.credScore);
                const stakedStr = ethers.formatUnits(data.totalStaked, 8);
                const winRate = total > 0 ? (correct / total) * 100 : 0;
                const acr = total > 0 ? credScore / total : 0;
                return {
                    agentId: id,
                    name: data.name,
                    description: data.description,
                    totalPredictions: total,
                    correctPredictions: correct,
                    credScore,
                    totalStaked: Number(stakedStr),
                    winRate,
                    acr,
                    active: data.active,
                } satisfies RankedAgent;
            }),
        );

        const agents = results
            .filter((r): r is PromiseFulfilledResult<RankedAgent> => r.status === "fulfilled")
            .map((r) => r.value);

        // Apply ranking logic
        return agents.sort((a, b) => {
            // 1. Probation status: Agents with < 5 rounds always sink below those with >= 5
            const aTested = a.totalPredictions >= this.PROBATION_FILTER;
            const bTested = b.totalPredictions >= this.PROBATION_FILTER;

            if (aTested && !bTested) return -1;
            if (!aTested && bTested) return 1;

            // 2. Primary Metric: ACR
            if (a.acr !== b.acr) {
                return b.acr - a.acr; // descending
            }

            // 3. Tie-breaker: Total Staked
            return b.totalStaked - a.totalStaked; // descending
        });
    }

    /**
     * Get a simple statistical summary for the UI
     */
    static getAcrInterpretation(acr: number, totalPredictions: number): string {
        if (totalPredictions < 5) return "Probationary";
        if (acr >= 80) return "Legendary";
        if (acr >= 30) return "Profitable";
        if (acr >= 0) return "Stagnant";
        return "Fraudulent";
    }
}
