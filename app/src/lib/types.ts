/**
 * Ascend — Common Types
 * 
 * Shared interfaces and types for the frontend application.
 */

export interface Agent {
    id: number;
    owner: string;
    name: string;
    description: string;
    totalPredictions: number;
    correctPredictions: number;
    credScore: number;
    registrationBond: bigint;
    totalStaked: bigint;
    registeredAt: number;
    active: boolean;
    accuracy: number; // Derived: (correctPredictions / totalPredictions) * 100
}

export interface Round {
    id: number;
    startPrice: number;
    endPrice: number;
    commitDeadline: number; // Unix timestamp seconds
    revealDeadline: number; // Unix timestamp seconds
    resolveAfter: number;   // Unix timestamp seconds
    entryFee: bigint;
    status: 0 | 1 | 2 | 3;  // Committing, Revealing, Resolved, Cancelled
    outcome: 0 | 1;         // UP, DOWN
    participantCount: number;
    revealedCount: number;
}

export interface Commitment {
    committed: boolean;
    revealed: boolean;
    scored: boolean;
    direction: 0 | 1; // UP, DOWN
    confidence: number;
}

export interface UserStake {
    amount: bigint;
    stakedAt: number;
}

export interface HCSMessage {
    consensusTimestamp: string;
    topicId: string;
    message: string;
    runningHash: string;
    sequenceNumber: number;
}

export interface PredictionMessage {
    type: string;
    agentId: string;
    timestamp: string;
    direction?: string;
    confidence?: number;
    reasoning?: string;
    roundId?: number;
}
