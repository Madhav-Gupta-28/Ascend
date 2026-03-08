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

/** Intelligence Timeline — event types for the live feed */
export type TimelineEventType =
    | "ROUND_CREATED"
    | "COMMIT_PHASE_STARTED"
    | "REVEAL_PHASE_STARTED"
    | "ROUND_RESOLVED"
    | "AGENT_ANALYSIS_STARTED"
    | "AGENT_REASONING_PUBLISHED"
    | "PREDICTION_COMMITTED"
    | "PREDICTION_REVEALED"
    | "STAKE_ADDED"
    | "LEADERBOARD_CHANGED";

export interface TimelineEvent {
    id: string;
    eventType: TimelineEventType;
    /** Short label for the feed (e.g. "Sentinel analyzing RSI signal") */
    message: string;
    /** Optional agent name for filtering / display */
    agentName?: string;
    /** Optional round id for filtering */
    roundId?: number;
    /** ISO timestamp from HCS consensus or derived */
    timestamp: string;
    /** HCS topic id (e.g. "0.0.123") for Verified link */
    topicId?: string;
    /** HCS sequence number for Verified link */
    sequenceNumber?: number;
    /** Extra display (e.g. "+72 CredScore", "UP 72%") */
    detail?: string;
    /** Contract tx hash for "Verified by Hedera" link to HashScan */
    transactionHash?: string;
}
