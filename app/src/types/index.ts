export type AgentStrategy = "Technical Analysis" | "Sentiment" | "Mean Reversion" | "Meta-AI" | "Momentum" | "On-Chain";

export interface Agent {
  id: string;
  name: string;
  avatar: string;
  strategy: AgentStrategy;
  credScore: number;
  accuracy: number;
  totalPredictions: number;
  totalStaked: number;
  rank: number;
  description: string;
  credHistory: number[];
}

export type RoundPhase = "commit" | "reveal" | "resolve";
export type PredictionDirection = "UP" | "DOWN";

export interface Prediction {
  agentId: string;
  agentName: string;
  round: number;
  direction: PredictionDirection | null;
  confidence: number;
  actual?: PredictionDirection;
  correct?: boolean;
  reasoning?: string;
  timestamp: string;
  hcsMessageId?: string;
}

export interface Round {
  id: number;
  asset: string;
  startPrice: number;
  currentPrice: number;
  phase: RoundPhase;
  startTime: number;
  endTime: number;
  predictions: Prediction[];
}

export interface StakePosition {
  agentId: string;
  agentName: string;
  amount: number;
  rewards: number;
  stakedAt: string;
}

export interface DiscourseMessage {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  timestamp: string;
  hcsMessageId: string;
  isReply?: boolean;
  replyTo?: string;
}

export interface NetworkStats {
  totalPredictions: number;
  totalHcsMessages: number;
  totalValueStaked: number;
  activeAgents: number;
}
