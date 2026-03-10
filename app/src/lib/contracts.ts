/**
 * Ascend — Contract Configuration
 * 
 * Provides ABIs and addresses for interacting with the Ascend smart contracts
 * via ethers.js on the frontend.
 */

// Contract ABIs (Human-Readable format)
export const AGENT_REGISTRY_ABI = [
    "function registerAgent(string name, string description) external payable returns (uint256)",
    "function getAgent(uint256 agentId) external view returns (tuple(address owner, string name, string description, uint256 totalPredictions, uint256 correctPredictions, int256 credScore, uint256 registrationBond, uint256 totalStaked, uint64 registeredAt, bool active))",
    "function getAgentCount() external view returns (uint256)",
    "function isAgentActive(uint256 agentId) external view returns (bool)",
    "function ownerToAgent(address) external view returns (uint256)",
    "event AgentRegistered(uint256 indexed agentId, address indexed owner, string name, uint256 bond)",
];

export const PREDICTION_MARKET_ABI = [
    "function createRound(uint64 commitDuration, uint64 revealDuration, uint64 roundDuration, uint256 startPrice, uint256 entryFee) external returns (uint256)",
    "function commitPrediction(uint256 roundId, uint256 agentId, bytes32 commitHash) external payable",
    "function revealPrediction(uint256 roundId, uint256 agentId, uint8 direction, uint256 confidence, bytes32 salt) external",
    "function resolveRound(uint256 roundId, uint256 endPrice) external",
    "function claimResult(uint256 roundId, uint256 agentId) external",
    "function cancelRound(uint256 roundId) external",
    "function getRound(uint256 roundId) external view returns (uint256 startPrice, uint256 endPrice, uint64 commitDeadline, uint64 revealDeadline, uint64 resolveAfter, uint256 entryFee, uint8 status, uint8 outcome, uint8 participantCount, uint8 revealedCount)",
    "function getCommitment(uint256 roundId, uint256 agentId) external view returns (bool committed, bool revealed, bool scored, uint8 direction, uint256 confidence)",
    "function getRoundCount() external view returns (uint256)",
    "function isRoundResolved(uint256 roundId) external view returns (bool)",
    "function getRoundOutcome(uint256 roundId) external view returns (uint8)",
    "event RoundCreated(uint256 indexed roundId, uint256 startPrice, uint64 commitDeadline, uint64 revealDeadline, uint64 resolveAfter, uint256 entryFee)",
    "event PredictionCommitted(uint256 indexed roundId, uint256 indexed agentId, bytes32 commitHash)",
    "event PredictionRevealed(uint256 indexed roundId, uint256 indexed agentId, uint8 direction, uint256 confidence)",
    "event RoundResolved(uint256 indexed roundId, uint256 endPrice, uint8 outcome)",
    "event ScoreClaimed(uint256 indexed roundId, uint256 indexed agentId, bool correct, int256 delta)",
];

export const STAKING_VAULT_ABI = [
    "function depositReward(uint256 agentId) external payable",
    "function stake(uint256 agentId) external payable",
    "function unstake(uint256 agentId, uint256 amount) external",
    "function claimReward(uint256 agentId) external",
    "function getUserStake(uint256 agentId, address user) external view returns (uint256 amount, uint64 stakedAt)",
    "function getTotalStakedOnAgent(uint256 agentId) external view returns (uint256)",
    "function getTVL() external view returns (uint256)",
    "function getPendingReward(uint256 agentId, address user) external view returns (uint256)",
    "function rewardPerTokenStored(uint256 agentId) external view returns (uint256)",
];

// Contract Addresses
export const CONTRACT_ADDRESSES = {
    // Use environment variables or fallback to empty strings to avoid crashes before configuration
    agentRegistry: process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS || "",
    predictionMarket: process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS || "",
    stakingVault: process.env.NEXT_PUBLIC_STAKING_VAULT_ADDRESS || "",
};

// HCS Topic IDs
export const TOPIC_IDS = {
    predictions: process.env.NEXT_PUBLIC_PREDICTIONS_TOPIC_ID || "",
    results: process.env.NEXT_PUBLIC_RESULTS_TOPIC_ID || "",
    legacyRounds: process.env.NEXT_PUBLIC_ASCEND_ROUNDS_TOPIC_ID || "",
};

// HTS Token ID
export const ASCEND_TOKEN_ID = process.env.NEXT_PUBLIC_ASCEND_TOKEN_ID || "";
