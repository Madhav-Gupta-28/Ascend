import type { AgentPrediction, AgentProfile } from "../../src/core/round-orchestrator.js";
import type { MarketData } from "../../src/core/data-collector.js";
import type { ContractClient } from "../../src/core/contract-client.js";
import { HTSClient } from "../../src/core/hts-client.js";

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

function basisConfidenceFromVolatility(data: MarketData): number {
    const range = data.price.high24h - data.price.low24h;
    const normalized = data.price.currentPrice > 0 ? (range / data.price.currentPrice) * 100 : 0;
    return clamp(Math.round(55 + normalized * 2), 45, 92);
}

export function buildHeuristicAgentProfiles(): AgentProfile[] {
    const sentinel: AgentProfile = {
        id: 1,
        name: "Sentinel",
        analyze: async (data) => {
            const latest = data.ohlc.at(-1);
            const prev = data.ohlc.at(-2);
            const momentum = latest && prev ? latest.close - prev.close : data.price.change24hPct;
            const direction = momentum >= 0 ? "UP" : "DOWN";
            const confidence = clamp(
                Math.round(basisConfidenceFromVolatility(data) + Math.abs(momentum) * 30),
                50,
                95,
            );
            return {
                direction,
                confidence,
                reasoning: `Momentum slope=${momentum.toFixed(4)} with 24h range ${data.price.low24h.toFixed(4)}-${data.price.high24h.toFixed(4)} suggests ${direction}.`,
            };
        },
    };

    const pulse: AgentProfile = {
        id: 2,
        name: "Pulse",
        analyze: async (data) => {
            const direction = data.price.change24hPct >= 0 ? "UP" : "DOWN";
            const volumeFactor = data.price.volume24h > 0 ? Math.log10(data.price.volume24h) : 1;
            const confidence = clamp(
                Math.round(52 + Math.abs(data.price.change24hPct) * 4 + volumeFactor),
                45,
                96,
            );
            return {
                direction,
                confidence,
                reasoning: `24h change=${data.price.change24hPct.toFixed(2)}% with volume=${data.price.volume24h.toFixed(0)} indicates ${direction} sentiment continuation.`,
            };
        },
    };

    const meridian: AgentProfile = {
        id: 3,
        name: "Meridian",
        analyze: async (data) => {
            const mean = (data.price.high24h + data.price.low24h) / 2;
            const deltaPct = mean > 0 ? ((data.price.currentPrice - mean) / mean) * 100 : 0;
            const direction = deltaPct > 0 ? "DOWN" : "UP";
            const confidence = clamp(Math.round(55 + Math.abs(deltaPct) * 6), 50, 90);
            return {
                direction,
                confidence,
                reasoning: `Price deviation from 24h mean=${deltaPct.toFixed(2)}% implies mean-reversion bias ${direction}.`,
            };
        },
    };

    const oracle: AgentProfile = {
        id: 4,
        name: "Oracle",
        analyze: async (data) => {
            const trend = data.price.change24hPct;
            const range = data.price.high24h - data.price.low24h;
            const direction = trend >= 0 || range === 0 ? "UP" : "DOWN";
            const confidence = clamp(
                Math.round(58 + Math.abs(trend) * 3 + (range / Math.max(data.price.currentPrice, 0.0001)) * 40),
                52,
                93,
            );
            return {
                direction,
                confidence,
                reasoning: `Meta-signal combines trend=${trend.toFixed(2)}% and volatility range=${range.toFixed(4)}, yielding ${direction}.`,
            };
        },
    };

    return [sentinel, pulse, meridian, oracle];
}

function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}

export async function ensureOwnedAgentProfiles(
    contracts: ContractClient,
    profiles: AgentProfile[],
): Promise<AgentProfile[]> {
    const myAddress = contracts.walletAddress.toLowerCase();
    const count = await contracts.getAgentCount();
    const ownedAgents: Array<{ id: number; name: string }> = [];

    for (let i = 1; i <= count; i++) {
        try {
            const agent = await contracts.getAgent(i);
            if (agent.owner.toLowerCase() === myAddress) {
                ownedAgents.push({ id: i, name: agent.name });
            }
        } catch {
            // ignore unreadable ids
        }
    }

    const usedIds = new Set<number>();

    for (const profile of profiles) {
        const desired = normalizeName(profile.name);
        let owned = ownedAgents.find(
            (entry) =>
                !usedIds.has(entry.id) &&
                (normalizeName(entry.name) === desired ||
                    normalizeName(entry.name).startsWith(`${desired}-`)),
        );

        if (!owned) {
            owned = ownedAgents.find((entry) => !usedIds.has(entry.id));
        }

        if (!owned) {
            const suffix = contracts.walletAddress.slice(-4).toLowerCase();
            const registrationCandidates = [
                profile.name,
                `${profile.name}-${suffix}`,
                `${profile.name}-${suffix}-${Date.now().toString().slice(-4)}`,
            ];

            let lastError: unknown = null;
            for (const candidateName of registrationCandidates) {
                try {
                    const newAgentId = Number(
                        await contracts.registerAgent(
                            candidateName,
                            `Ascend AI Agent: ${profile.name}`,
                            10,
                        ),
                    );
                    owned = { id: newAgentId, name: candidateName };
                    ownedAgents.push(owned);
                    break;
                } catch (error: any) {
                    lastError = error;
                    const message = String(error?.message || error);
                    if (!message.includes("Already registered")) {
                        throw error;
                    }
                }
            }

            if (!owned) {
                throw new Error(
                    `Could not provision an owned on-chain agent slot for ${profile.name}: ${String(lastError)}`,
                );
            }
        }

        usedIds.add(owned.id);
        profile.id = owned.id;
    }

    return profiles;
}

export interface AgentEnvIdentity {
    accountId?: string;
    privateKey?: string;
}

export function getAgentIdentityByName(agentName: string): AgentEnvIdentity {
    const key = agentName.toUpperCase();
    return {
        accountId: process.env[`${key}_ACCOUNT_ID`],
        privateKey: process.env[`${key}_PRIVATE_KEY`],
    };
}

export function getWinningAgentNames(predictions: AgentPrediction[], outcome: "UP" | "DOWN"): string[] {
    return predictions
        .filter((prediction) => (prediction.direction === 0 ? "UP" : "DOWN") === outcome)
        .map((prediction) => prediction.agentName);
}

export async function distributeHtsWinnerRewards(
    htsClient: HTSClient,
    predictions: AgentPrediction[],
    outcome: "UP" | "DOWN",
    rewardPerWinnerTokens: string | number,
): Promise<{
    rewardedAgentNames: string[];
    status: string;
    totalTinyUnits: bigint;
}> {
    const winners = getWinningAgentNames(predictions, outcome);
    const recipientAccountIds: string[] = [];

    for (const winner of winners) {
        const identity = getAgentIdentityByName(winner);
        if (!identity.accountId) continue;

        if (identity.privateKey) {
            const association = await htsClient.associateToken(
                identity.accountId,
                identity.privateKey,
            );
            if (!association.success) {
                throw new Error(
                    `Failed token association for ${winner} (${identity.accountId}): ${association.status}`,
                );
            }
        }

        recipientAccountIds.push(identity.accountId);
    }

    if (recipientAccountIds.length === 0) {
        return {
            rewardedAgentNames: [],
            status: "NO_ASSOCIATED_WINNER_ACCOUNTS",
            totalTinyUnits: 0n,
        };
    }

    const reward = await htsClient.rewardAccountsEqual(
        recipientAccountIds,
        rewardPerWinnerTokens,
    );
    return {
        rewardedAgentNames: winners,
        status: reward.status,
        totalTinyUnits: reward.totalTinyUnits,
    };
}
