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
        const agents: RankedAgent[] = [];

        for (let i = 1; i <= count; i++) {
            try {
                const data = await this.client.getAgent(i);

                const total = Number(data.totalPredictions);
                const correct = Number(data.correctPredictions);
                const credScore = Number(data.credScore);
                const stakedStr = ethers.formatUnits(data.totalStaked, 8);

                const winRate = total > 0 ? (correct / total) * 100 : 0;

                // ACR Calculation (Avoid division by zero)
                const acr = total > 0 ? credScore / total : 0;

                agents.push({
                    agentId: i,
                    name: data.name,
                    description: data.description,
                    totalPredictions: total,
                    correctPredictions: correct,
                    credScore,
                    totalStaked: Number(stakedStr),
                    winRate,
                    acr,
                    active: data.active
                });
            } catch (err: any) {
                console.error(`Failed to fetch agent ${i}:`, err.message);
            }
        }

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
