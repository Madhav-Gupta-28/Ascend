// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./AgentRegistry.sol";

/// @title PredictionMarket — Commit-reveal prediction rounds
/// @author Ascend Protocol
/// @notice Handles round lifecycle and commit-reveal protocol
/// @dev KEY DESIGN: No loops that scale with participant count.
///      resolveRound only sets the outcome. Score updates happen
///      via individual claimResult() calls (1 tx per agent).
contract PredictionMarket is Ownable {
    uint8 public constant MAX_PARTICIPANTS_PER_ROUND = 16;
    // ── Enums ──

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

    // ── Structs ──

    struct Round {
        uint256 startPrice; // HBAR/USD × 10^8
        uint256 endPrice; // Set at resolution
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 resolveAfter;
        uint256 entryFee; // HBAR per agent
        uint256 rewardPool; // Accumulated entry fees
        RoundStatus status;
        Direction outcome; // Set at resolution
        uint8 participantCount; // Bounded by MAX_AGENTS (no array needed)
        uint8 revealedCount; // How many revealed
        uint8 claimedCount; // How many claimed results
    }

    struct Commitment {
        bytes32 commitHash;
        Direction direction;
        uint256 confidence;
        bool committed;
        bool revealed;
        bool scored; // Whether score was claimed
    }

    // ── State ──

    AgentRegistry public registry;
    uint256 public nextRoundId = 1;

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(uint256 => Commitment)) public commitments; // roundId => agentId

    // ── Events ──

    event RoundCreated(
        uint256 indexed roundId,
        uint256 startPrice,
        uint64 commitDeadline,
        uint64 revealDeadline,
        uint64 resolveAfter,
        uint256 entryFee
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
    event ScoreClaimed(
        uint256 indexed roundId,
        uint256 indexed agentId,
        bool correct,
        int256 credScoreDelta
    );
    event RewardPoolWithdrawn(
        uint256 indexed roundId,
        address indexed to,
        uint256 amount,
        uint256 remainingRewardPool
    );
    event RoundCancelled(uint256 indexed roundId);

    // ── Constructor ──

    constructor(address _registry) Ownable(msg.sender) {
        require(_registry != address(0), "Invalid registry");
        registry = AgentRegistry(_registry);
    }

    // ══════════════════════════════════════════
    // ROUND MANAGEMENT
    // ══════════════════════════════════════════

    /// @notice Create a new prediction round
    /// @param commitDuration Seconds for commit phase
    /// @param revealDuration Seconds for reveal phase (after commit ends)
    /// @param roundDuration Total seconds before resolution allowed
    /// @param startPrice HBAR/USD price × 10^8
    /// @param entryFee HBAR fee per agent (can be 0)
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
        require(
            roundDuration >= commitDuration + revealDuration,
            "Round too short"
        );
        require(startPrice > 0, "Invalid start price");

        uint256 roundId = nextRoundId++;
        uint64 now_ = uint64(block.timestamp);

        Round storage round = rounds[roundId];
        round.startPrice = startPrice;
        round.commitDeadline = now_ + commitDuration;
        round.revealDeadline = now_ + commitDuration + revealDuration;
        round.resolveAfter = now_ + roundDuration;
        round.entryFee = entryFee;
        round.status = RoundStatus.Committing;

        emit RoundCreated(
            roundId,
            startPrice,
            round.commitDeadline,
            round.revealDeadline,
            round.resolveAfter,
            entryFee
        );
        return roundId;
    }

    // ══════════════════════════════════════════
    // COMMIT PHASE — O(1) per agent
    // ══════════════════════════════════════════

    /// @notice Submit a hashed prediction
    /// @param roundId The round to predict in
    /// @param agentId The agent making the prediction
    /// @param commitHash keccak256(abi.encodePacked(uint8(direction), confidence, salt))
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
        require(commitHash != bytes32(0), "Empty commit hash");

        AgentRegistry.Agent memory agent = registry.getAgent(agentId);
        require(agent.owner == msg.sender, "Not agent owner");
        require(agent.active, "Agent not active");

        Commitment storage c = commitments[roundId][agentId];
        require(!c.committed, "Already committed");
        require(
            round.participantCount < MAX_PARTICIPANTS_PER_ROUND,
            "Round participant limit reached"
        );

        c.commitHash = commitHash;
        c.committed = true;
        round.participantCount++;
        round.rewardPool += msg.value;

        emit PredictionCommitted(roundId, agentId, commitHash);
    }

    // ══════════════════════════════════════════
    // REVEAL PHASE — O(1) per agent
    // ══════════════════════════════════════════

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

        // Auto-transition from Committing to Revealing
        if (
            round.status == RoundStatus.Committing &&
            block.timestamp > round.commitDeadline
        ) {
            round.status = RoundStatus.Revealing;
        }

        require(round.status == RoundStatus.Revealing, "Not in reveal phase");
        require(
            block.timestamp <= round.revealDeadline,
            "Reveal deadline passed"
        );

        AgentRegistry.Agent memory agent = registry.getAgent(agentId);
        require(agent.owner == msg.sender, "Not agent owner");

        Commitment storage c = commitments[roundId][agentId];
        require(c.committed, "Not committed");
        require(!c.revealed, "Already revealed");
        require(confidence <= 100, "Confidence out of range");

        // Verify hash integrity
        bytes32 expectedHash = keccak256(
            abi.encodePacked(uint8(direction), confidence, salt)
        );
        require(expectedHash == c.commitHash, "Hash mismatch");

        c.direction = direction;
        c.confidence = confidence;
        c.revealed = true;
        round.revealedCount++;

        emit PredictionRevealed(roundId, agentId, direction, confidence);
    }

    // ══════════════════════════════════════════
    // RESOLUTION — O(1), no loops
    // ══════════════════════════════════════════

    /// @notice Resolve a round with the actual end price
    /// @dev Only sets the outcome. Score updates happen via claimResult().
    ///      This is the key optimization: resolveRound is O(1) regardless
    ///      of participant count. No loops, no cross-contract calls.
    /// @param roundId The round to resolve
    /// @param endPrice The actual HBAR/USD price × 10^8
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
        round.outcome = endPrice >= round.startPrice
            ? Direction.UP
            : Direction.DOWN;
        round.status = RoundStatus.Resolved;

        emit RoundResolved(roundId, endPrice, round.outcome);
    }

    /// @notice Claim score update for a specific agent in a resolved round
    /// @dev Called once per agent per round — O(1). Replaces the old loop.
    ///      The orchestrator calls this for each agent after resolution.
    /// @param roundId The resolved round
    /// @param agentId The agent to score
    function claimResult(uint256 roundId, uint256 agentId) external {
        Round storage round = rounds[roundId];
        require(round.status == RoundStatus.Resolved, "Round not resolved");

        Commitment storage c = commitments[roundId][agentId];
        require(c.revealed, "Not revealed");
        require(!c.scored, "Already scored");

        c.scored = true;
        round.claimedCount++;

        bool correct = (c.direction == round.outcome);
        registry.updateScore(agentId, correct, c.confidence);

        int256 delta = correct ? int256(c.confidence) : -int256(c.confidence);
        emit ScoreClaimed(roundId, agentId, correct, delta);
    }

    // ══════════════════════════════════════════
    // CANCELLATION
    // ══════════════════════════════════════════

    /// @notice Cancel a round (operator emergency)
    function cancelRound(uint256 roundId) external onlyOwner {
        Round storage round = rounds[roundId];
        require(round.status != RoundStatus.Resolved, "Already resolved");
        require(round.status != RoundStatus.Cancelled, "Already cancelled");
        round.status = RoundStatus.Cancelled;

        emit RoundCancelled(roundId);
    }

    /// @notice Withdraw reward pool funds from a resolved round
    /// @dev Allows orchestrator reward routing to be funded by round entry fees
    ///      instead of the operator wallet balance.
    function withdrawRewardPool(
        uint256 roundId,
        uint256 amount,
        address payable to
    ) external onlyOwner {
        Round storage round = rounds[roundId];
        require(round.status == RoundStatus.Resolved, "Round not resolved");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(amount <= round.rewardPool, "Insufficient reward pool");

        round.rewardPool -= amount;

        (bool sent, ) = to.call{value: amount}("");
        require(sent, "HBAR transfer failed");

        emit RewardPoolWithdrawn(roundId, to, amount, round.rewardPool);
    }

    // ══════════════════════════════════════════
    // VIEW FUNCTIONS (free via eth_call)
    // ══════════════════════════════════════════

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
            Direction outcome,
            uint8 participantCount,
            uint8 revealedCount
        )
    {
        Round storage r = rounds[roundId];
        return (
            r.startPrice,
            r.endPrice,
            r.commitDeadline,
            r.revealDeadline,
            r.resolveAfter,
            r.entryFee,
            r.status,
            r.outcome,
            r.participantCount,
            r.revealedCount
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
            bool scored,
            Direction direction,
            uint256 confidence
        )
    {
        Commitment storage c = commitments[roundId][agentId];
        return (c.committed, c.revealed, c.scored, c.direction, c.confidence);
    }

    function getRoundCount() external view returns (uint256) {
        return nextRoundId - 1;
    }

    function isRoundResolved(uint256 roundId) external view returns (bool) {
        return rounds[roundId].status == RoundStatus.Resolved;
    }

    function getRoundOutcome(
        uint256 roundId
    ) external view returns (Direction) {
        require(rounds[roundId].status == RoundStatus.Resolved, "Not resolved");
        return rounds[roundId].outcome;
    }

    function getRoundRewardPool(uint256 roundId) external view returns (uint256) {
        return rounds[roundId].rewardPool;
    }
}
