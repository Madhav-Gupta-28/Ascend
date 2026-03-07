// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AgentRegistry.sol";

/// @title PredictionMarket — Commit-reveal prediction rounds with integrated staking
/// @notice Handles round lifecycle, commit-reveal protocol, scoring, and HBAR staking
contract PredictionMarket is Ownable, ReentrancyGuard {
    enum Direction {
        UP,
        DOWN
    }
    enum RoundStatus {
        Committing,
        Revealing,
        Resolved,
        Cancelled
    }

    struct Round {
        uint256 startPrice; // Price at round start (8 decimals, × 10^8)
        uint256 endPrice; // Price at round end (set during resolution)
        uint64 commitDeadline; // Timestamp: no commits after this
        uint64 revealDeadline; // Timestamp: no reveals after this
        uint64 resolveAfter; // Timestamp: can resolve after this
        uint256 entryFee; // HBAR entry fee per agent
        RoundStatus status;
        uint256[] participantIds; // Agent IDs that committed
    }

    struct Commitment {
        bytes32 commitHash;
        Direction direction;
        uint256 confidence;
        bool committed;
        bool revealed;
    }

    struct Stake {
        uint256 amount;
    }

    AgentRegistry public registry;
    uint256 public nextRoundId = 1;

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(uint256 => Commitment)) public commitments; // roundId => agentId => commitment
    mapping(uint256 => mapping(address => Stake)) public stakes; // agentId => user => stake
    mapping(uint256 => uint256) public totalAgentStakes; // agentId => total staked

    event RoundCreated(
        uint256 indexed roundId,
        uint256 startPrice,
        uint64 commitDeadline,
        uint64 revealDeadline
    );
    event PredictionCommitted(
        uint256 indexed roundId,
        uint256 indexed agentId,
        bytes32 commitHash
    );
    event PredictionRevealed(
        uint256 indexed roundId,
        uint256 indexed agentId,
        Direction direction,
        uint256 confidence
    );
    event RoundResolved(
        uint256 indexed roundId,
        uint256 endPrice,
        Direction outcome
    );
    event Staked(uint256 indexed agentId, address indexed user, uint256 amount);
    event Unstaked(
        uint256 indexed agentId,
        address indexed user,
        uint256 amount
    );

    constructor(address _registry) Ownable(msg.sender) {
        registry = AgentRegistry(_registry);
    }

    // ── Round Management ──

    /// @notice Create a new prediction round (operator only)
    /// @param commitDuration Seconds agents have to commit
    /// @param revealDuration Seconds agents have to reveal after commit phase
    /// @param roundDuration Seconds from round start to resolution eligibility
    /// @param startPrice Starting HBAR/USD price (8 decimal precision)
    /// @param entryFee HBAR fee per agent to participate
    function createRound(
        uint64 commitDuration,
        uint64 revealDuration,
        uint64 roundDuration,
        uint256 startPrice,
        uint256 entryFee
    ) external onlyOwner returns (uint256) {
        require(
            commitDuration > 0 && revealDuration > 0 && roundDuration > 0,
            "Invalid durations"
        );
        require(startPrice > 0, "Invalid start price");

        uint256 roundId = nextRoundId++;
        uint64 now_ = uint64(block.timestamp);

        rounds[roundId].startPrice = startPrice;
        rounds[roundId].commitDeadline = now_ + commitDuration;
        rounds[roundId].revealDeadline = now_ + commitDuration + revealDuration;
        rounds[roundId].resolveAfter = now_ + roundDuration;
        rounds[roundId].entryFee = entryFee;
        rounds[roundId].status = RoundStatus.Committing;

        emit RoundCreated(
            roundId,
            startPrice,
            rounds[roundId].commitDeadline,
            rounds[roundId].revealDeadline
        );
        return roundId;
    }

    // ── Commit-Reveal Protocol ──

    /// @notice Submit a hashed prediction (commit phase)
    /// @param roundId The round to predict in
    /// @param agentId The agent making the prediction
    /// @param commitHash keccak256(abi.encodePacked(direction, confidence, salt))
    function commitPrediction(
        uint256 roundId,
        uint256 agentId,
        bytes32 commitHash
    ) external payable {
        Round storage round = rounds[roundId];
        require(round.status == RoundStatus.Committing, "Not in commit phase");
        require(
            block.timestamp <= round.commitDeadline,
            "Commit deadline passed"
        );
        require(msg.value >= round.entryFee, "Insufficient entry fee");

        AgentRegistry.Agent memory agent = registry.getAgent(agentId);
        require(agent.owner == msg.sender, "Not agent owner");
        require(agent.active, "Agent not active");

        Commitment storage commitment = commitments[roundId][agentId];
        require(!commitment.committed, "Already committed");

        commitment.commitHash = commitHash;
        commitment.committed = true;

        round.participantIds.push(agentId);

        emit PredictionCommitted(roundId, agentId, commitHash);
    }

    /// @notice Reveal a previously committed prediction
    /// @param roundId The round
    /// @param agentId The agent
    /// @param direction UP (0) or DOWN (1)
    /// @param confidence 0-100
    /// @param salt Random bytes32 used in the commit hash
    function revealPrediction(
        uint256 roundId,
        uint256 agentId,
        Direction direction,
        uint256 confidence,
        bytes32 salt
    ) external {
        Round storage round = rounds[roundId];
        require(
            round.status == RoundStatus.Committing ||
                round.status == RoundStatus.Revealing,
            "Not in reveal phase"
        );
        require(
            block.timestamp > round.commitDeadline,
            "Commit phase still active"
        );
        require(
            block.timestamp <= round.revealDeadline,
            "Reveal deadline passed"
        );

        // Update status to Revealing if still Committing
        if (round.status == RoundStatus.Committing) {
            round.status = RoundStatus.Revealing;
        }

        AgentRegistry.Agent memory agent = registry.getAgent(agentId);
        require(agent.owner == msg.sender, "Not agent owner");

        Commitment storage commitment = commitments[roundId][agentId];
        require(commitment.committed, "Not committed");
        require(!commitment.revealed, "Already revealed");
        require(confidence <= 100, "Confidence out of range");

        // Verify hash
        bytes32 expectedHash = keccak256(
            abi.encodePacked(uint8(direction), confidence, salt)
        );
        require(expectedHash == commitment.commitHash, "Hash mismatch");

        commitment.direction = direction;
        commitment.confidence = confidence;
        commitment.revealed = true;

        emit PredictionRevealed(roundId, agentId, direction, confidence);
    }

    /// @notice Resolve a round with the actual end price (operator only)
    /// @param roundId The round to resolve
    /// @param endPrice The actual HBAR/USD price at round end (8 decimal precision)
    function resolveRound(
        uint256 roundId,
        uint256 endPrice
    ) external onlyOwner {
        Round storage round = rounds[roundId];
        require(
            round.status == RoundStatus.Committing ||
                round.status == RoundStatus.Revealing,
            "Round not active"
        );
        require(block.timestamp >= round.resolveAfter, "Too early to resolve");
        require(endPrice > 0, "Invalid end price");

        round.endPrice = endPrice;
        round.status = RoundStatus.Resolved;

        Direction outcome = endPrice >= round.startPrice
            ? Direction.UP
            : Direction.DOWN;

        // Update scores for all revealed agents
        for (uint256 i = 0; i < round.participantIds.length; i++) {
            uint256 agentId = round.participantIds[i];
            Commitment storage commitment = commitments[roundId][agentId];

            if (commitment.revealed) {
                bool correct = (commitment.direction == outcome);
                registry.updateScore(agentId, correct, commitment.confidence);
            }
        }

        emit RoundResolved(roundId, endPrice, outcome);
    }

    /// @notice Cancel a round (operator only, emergency)
    function cancelRound(uint256 roundId) external onlyOwner {
        require(
            rounds[roundId].status != RoundStatus.Resolved,
            "Already resolved"
        );
        require(
            rounds[roundId].status != RoundStatus.Cancelled,
            "Already cancelled"
        );
        rounds[roundId].status = RoundStatus.Cancelled;
    }

    // ── Staking ──

    /// @notice Stake HBAR on an agent
    /// @param agentId The agent to stake on
    function stakeOnAgent(uint256 agentId) external payable nonReentrant {
        require(msg.value > 0, "Must stake > 0");
        require(registry.isAgentActive(agentId), "Agent not active");

        stakes[agentId][msg.sender].amount += msg.value;
        totalAgentStakes[agentId] += msg.value;

        registry.updateTotalStaked(agentId, int256(msg.value));

        emit Staked(agentId, msg.sender, msg.value);
    }

    /// @notice Unstake HBAR from an agent
    /// @param agentId The agent to unstake from
    /// @param amount Amount of HBAR to withdraw
    function unstake(uint256 agentId, uint256 amount) external nonReentrant {
        require(amount > 0, "Must unstake > 0");
        require(
            stakes[agentId][msg.sender].amount >= amount,
            "Insufficient stake"
        );

        stakes[agentId][msg.sender].amount -= amount;
        totalAgentStakes[agentId] -= amount;

        registry.updateTotalStaked(agentId, -int256(amount));

        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "HBAR transfer failed");

        emit Unstaked(agentId, msg.sender, amount);
    }

    // ── View Functions ──

    function getRound(
        uint256 roundId
    )
        external
        view
        returns (
            uint256 startPrice,
            uint256 endPrice,
            uint64 commitDeadline,
            uint64 revealDeadline,
            uint64 resolveAfter,
            uint256 entryFee,
            RoundStatus status,
            uint256 participantCount
        )
    {
        Round storage round = rounds[roundId];
        return (
            round.startPrice,
            round.endPrice,
            round.commitDeadline,
            round.revealDeadline,
            round.resolveAfter,
            round.entryFee,
            round.status,
            round.participantIds.length
        );
    }

    function getCommitment(
        uint256 roundId,
        uint256 agentId
    )
        external
        view
        returns (
            bool committed,
            bool revealed,
            Direction direction,
            uint256 confidence
        )
    {
        Commitment storage c = commitments[roundId][agentId];
        return (c.committed, c.revealed, c.direction, c.confidence);
    }

    function getParticipantIds(
        uint256 roundId
    ) external view returns (uint256[] memory) {
        return rounds[roundId].participantIds;
    }

    function getUserStake(
        uint256 agentId,
        address user
    ) external view returns (uint256) {
        return stakes[agentId][user].amount;
    }

    function getRoundCount() external view returns (uint256) {
        return nextRoundId - 1;
    }
}
