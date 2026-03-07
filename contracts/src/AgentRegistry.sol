// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentRegistry — Identity and reputation ledger for AI agents
/// @author Ascend Protocol
/// @notice Manages agent registration, HBAR bonds, and confidence-weighted scoring
/// @dev Central identity contract — PredictionMarket and StakingVault call into this
contract AgentRegistry is Ownable {
    // ── Structs ──

    struct Agent {
        address owner; // Wallet that controls this agent
        string name; // Display name (max 32 bytes)
        string description; // Strategy description
        uint256 totalPredictions; // Lifetime predictions submitted
        uint256 correctPredictions; // Lifetime correct predictions
        int256 credScore; // Confidence-weighted score (can be negative)
        uint256 registrationBond; // HBAR bond locked at registration
        uint256 totalStaked; // Total HBAR staked on this agent by users
        uint64 registeredAt; // Block timestamp of registration
        bool active; // Can participate in rounds
    }

    // ── Constants ──

    uint256 public constant MIN_BOND = 10 ether; // 10 HBAR (18 decimals on Hedera EVM)
    uint256 public constant MAX_AGENTS = 100; // Hard cap for hackathon

    // ── State ──

    uint256 public nextAgentId = 1;
    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) public ownerToAgent;
    mapping(address => bool) public authorizedCallers;

    // ── Events ──

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        string name,
        uint256 bond
    );
    event AgentDeactivated(uint256 indexed agentId);
    event CredScoreUpdated(
        uint256 indexed agentId,
        int256 delta,
        int256 newScore,
        uint256 totalPredictions,
        uint256 correctPredictions
    );
    event TotalStakedUpdated(uint256 indexed agentId, uint256 newTotal);
    event AuthorizedCallerSet(address indexed caller, bool authorized);
    event BondWithdrawn(
        uint256 indexed agentId,
        address indexed owner,
        uint256 amount
    );

    // ── Modifiers ──

    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender], "Not authorized");
        _;
    }

    modifier validAgent(uint256 agentId) {
        require(agentId > 0 && agentId < nextAgentId, "Agent does not exist");
        _;
    }

    // ── Constructor ──

    constructor() Ownable(msg.sender) {}

    // ── Agent Management ──

    /// @notice Register a new agent with an HBAR bond
    /// @param name Agent display name (1-32 bytes)
    /// @param description Agent strategy description
    /// @return agentId The ID of the newly registered agent
    function registerAgent(
        string calldata name,
        string calldata description
    ) external payable returns (uint256) {
        require(msg.value >= MIN_BOND, "Bond too low");
        require(ownerToAgent[msg.sender] == 0, "Already registered");
        require(
            bytes(name).length > 0 && bytes(name).length <= 32,
            "Invalid name length"
        );
        require(nextAgentId <= MAX_AGENTS, "Max agents reached");

        uint256 agentId = nextAgentId++;

        agents[agentId] = Agent({
            owner: msg.sender,
            name: name,
            description: description,
            totalPredictions: 0,
            correctPredictions: 0,
            credScore: 0,
            registrationBond: msg.value,
            totalStaked: 0,
            registeredAt: uint64(block.timestamp),
            active: true
        });

        ownerToAgent[msg.sender] = agentId;

        emit AgentRegistered(agentId, msg.sender, name, msg.value);
        return agentId;
    }

    /// @notice Deactivate an agent and allow bond withdrawal
    /// @param agentId The agent to deactivate
    function deactivateAgent(uint256 agentId) external validAgent(agentId) {
        require(agents[agentId].owner == msg.sender, "Not agent owner");
        require(agents[agentId].active, "Already deactivated");
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    /// @notice Withdraw registration bond after deactivation
    /// @param agentId The agent whose bond to withdraw
    function withdrawBond(uint256 agentId) external validAgent(agentId) {
        Agent storage agent = agents[agentId];
        require(agent.owner == msg.sender, "Not agent owner");
        require(!agent.active, "Agent still active");
        require(agent.registrationBond > 0, "No bond to withdraw");

        uint256 bondAmount = agent.registrationBond;
        agent.registrationBond = 0;

        (bool sent, ) = payable(msg.sender).call{value: bondAmount}("");
        require(sent, "HBAR transfer failed");

        emit BondWithdrawn(agentId, msg.sender, bondAmount);
    }

    // ── Authorized-Only Updates ──

    /// @notice Update score after a round resolution (called by PredictionMarket)
    /// @dev No loops — called once per agent per round from the orchestrator
    /// @param agentId The agent to update
    /// @param correct Whether the prediction was correct
    /// @param confidence The confidence value (0-100)
    function updateScore(
        uint256 agentId,
        bool correct,
        uint256 confidence
    ) external onlyAuthorized validAgent(agentId) {
        require(agents[agentId].active, "Agent not active");
        require(confidence <= 100, "Confidence out of range");

        Agent storage agent = agents[agentId];
        agent.totalPredictions++;

        int256 delta;
        if (correct) {
            agent.correctPredictions++;
            delta = int256(confidence);
            agent.credScore += delta;
        } else {
            delta = -int256(confidence);
            agent.credScore += delta;
        }

        emit CredScoreUpdated(
            agentId,
            delta,
            agent.credScore,
            agent.totalPredictions,
            agent.correctPredictions
        );
    }

    /// @notice Update total staked amount (called by StakingVault)
    /// @param agentId The agent to update
    /// @param delta Positive for new stakes, negative for withdrawals
    function updateTotalStaked(
        uint256 agentId,
        int256 delta
    ) external onlyAuthorized validAgent(agentId) {
        if (delta > 0) {
            agents[agentId].totalStaked += uint256(delta);
        } else {
            uint256 decrease = uint256(-delta);
            require(
                agents[agentId].totalStaked >= decrease,
                "Staked underflow"
            );
            agents[agentId].totalStaked -= decrease;
        }

        emit TotalStakedUpdated(agentId, agents[agentId].totalStaked);
    }

    // ── Admin ──

    /// @notice Authorize a contract to call updateScore / updateTotalStaked
    function setAuthorizedCaller(
        address caller,
        bool authorized
    ) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    // ── View Functions (free via JSON-RPC eth_call) ──

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    function getAgentCount() external view returns (uint256) {
        return nextAgentId - 1;
    }

    function isAgentActive(uint256 agentId) external view returns (bool) {
        return agents[agentId].active;
    }

    function getAgentOwner(uint256 agentId) external view returns (address) {
        return agents[agentId].owner;
    }
}
