// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AgentRegistry.sol";

/// @title StakingVault — HBAR staking on AI agents
/// @author Ascend Protocol
/// @notice Users stake HBAR on agents they believe will perform well
/// @dev Separated from PredictionMarket. Uses rewardPerToken math.
contract StakingVault is Ownable, ReentrancyGuard {
    // ── Structs ──

    struct UserStake {
        uint256 amount; // HBAR staked
        uint64 stakedAt; // When the stake was placed
        uint256 lastRewardRound; // (Legacy/unused field, kept for struct shape)
    }

    // ── State ──

    AgentRegistry public registry;

    mapping(uint256 => mapping(address => UserStake)) public userStakes; // agentId => user => stake
    mapping(uint256 => uint256) public totalStakedOnAgent; // agentId => total HBAR

    // Reward math state
    mapping(uint256 => uint256) public rewardPerTokenStored; // agentId => reward per 1e18 staked
    mapping(uint256 => mapping(address => uint256))
        public userRewardPerTokenPaid;
    mapping(uint256 => mapping(address => uint256)) public rewards; // Unclaimed rewards

    uint256 public totalValueLocked; // Global TVL

    // ── Events ──

    event Staked(
        uint256 indexed agentId,
        address indexed user,
        uint256 amount,
        uint256 newTotal
    );
    event Unstaked(
        uint256 indexed agentId,
        address indexed user,
        uint256 amount,
        uint256 newTotal
    );
    event RewardDeposited(uint256 indexed agentId, uint256 amount);
    event RewardClaimed(
        uint256 indexed agentId,
        address indexed user,
        uint256 amount
    );

    // ── Constructor ──

    constructor(address _registry) Ownable(msg.sender) {
        require(_registry != address(0), "Invalid registry");
        registry = AgentRegistry(_registry);
    }

    // ══════════════════════════════════════════
    // INTERNAL REWARD MATH
    // ══════════════════════════════════════════

    modifier updateReward(uint256 agentId, address user) {
        uint256 amount = userStakes[agentId][user].amount;
        uint256 rpt = rewardPerTokenStored[agentId];

        rewards[agentId][user] +=
            (amount * (rpt - userRewardPerTokenPaid[agentId][user])) /
            1e18;
        userRewardPerTokenPaid[agentId][user] = rpt;
        _;
    }

    // ══════════════════════════════════════════
    // STAKING — O(1) per operation
    // ══════════════════════════════════════════

    /// @notice Stake HBAR on an agent
    /// @param agentId The agent to stake on
    function stake(
        uint256 agentId
    ) external payable nonReentrant updateReward(agentId, msg.sender) {
        require(msg.value > 0, "Must stake > 0");
        require(registry.isAgentActive(agentId), "Agent not active");

        UserStake storage s = userStakes[agentId][msg.sender];
        s.amount += msg.value;
        if (s.stakedAt == 0) {
            s.stakedAt = uint64(block.timestamp);
        }

        totalStakedOnAgent[agentId] += msg.value;
        totalValueLocked += msg.value;

        // Update AgentRegistry's totalStaked
        registry.updateTotalStaked(agentId, int256(msg.value));

        emit Staked(
            agentId,
            msg.sender,
            msg.value,
            totalStakedOnAgent[agentId]
        );
    }

    /// @notice Unstake HBAR from an agent
    /// @param agentId The agent to unstake from
    /// @param amount Amount of HBAR to withdraw
    function unstake(
        uint256 agentId,
        uint256 amount
    ) external nonReentrant updateReward(agentId, msg.sender) {
        require(amount > 0, "Must unstake > 0");

        UserStake storage s = userStakes[agentId][msg.sender];
        require(s.amount >= amount, "Insufficient stake");

        s.amount -= amount;
        totalStakedOnAgent[agentId] -= amount;
        totalValueLocked -= amount;

        // Update AgentRegistry
        registry.updateTotalStaked(agentId, -int256(amount));

        // Transfer HBAR back — checks-effects-interactions pattern
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "HBAR transfer failed");

        emit Unstaked(agentId, msg.sender, amount, totalStakedOnAgent[agentId]);
    }

    // ══════════════════════════════════════════
    // REWARDS — operator deposits, users claim
    // ══════════════════════════════════════════

    /// @notice Deposit reward HBAR for stakers of a specific agent
    /// @dev Called by operator after round resolution to reward correct predictions
    /// @param agentId The winning agent
    function depositReward(uint256 agentId) external payable onlyOwner {
        require(msg.value > 0, "No reward");

        uint256 total = totalStakedOnAgent[agentId];
        if (total > 0) {
            // Add to reward per token stored (multiplied by 1e18 for precision)
            rewardPerTokenStored[agentId] += (msg.value * 1e18) / total;
        }
        // If total == 0, the reward is effectively lost in the contract balance

        emit RewardDeposited(agentId, msg.value);
    }

    /// @notice Claim proportional reward based on stake
    /// @param agentId The agent rewards are claimed from
    function claimReward(
        uint256 agentId
    ) external nonReentrant updateReward(agentId, msg.sender) {
        uint256 reward = rewards[agentId][msg.sender];
        require(reward > 0, "No rewards available");

        rewards[agentId][msg.sender] = 0;

        (bool sent, ) = payable(msg.sender).call{value: reward}("");
        require(sent, "HBAR transfer failed");

        emit RewardClaimed(agentId, msg.sender, reward);
    }

    // ══════════════════════════════════════════
    // VIEW FUNCTIONS (free via eth_call)
    // ══════════════════════════════════════════

    function getUserStake(
        uint256 agentId,
        address user
    ) external view returns (uint256 amount, uint64 stakedAt) {
        UserStake storage s = userStakes[agentId][user];
        return (s.amount, s.stakedAt);
    }

    function getTotalStakedOnAgent(
        uint256 agentId
    ) external view returns (uint256) {
        return totalStakedOnAgent[agentId];
    }

    function getTVL() external view returns (uint256) {
        return totalValueLocked;
    }

    function getPendingReward(
        uint256 agentId,
        address user
    ) external view returns (uint256) {
        uint256 amount = userStakes[agentId][user].amount;
        uint256 rpt = rewardPerTokenStored[agentId];

        uint256 pending = (amount *
            (rpt - userRewardPerTokenPaid[agentId][user])) / 1e18;
        return rewards[agentId][user] + pending;
    }
}
