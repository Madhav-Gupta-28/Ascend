// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentRegistry — Identity and reputation ledger for AI agents
/// @notice Manages agent registration with HBAR bonds and confidence-weighted scoring
contract AgentRegistry is Ownable {

    struct Agent {
        address owner;
        string name;
        string description;
        uint256 totalPredictions;
        uint256 correctPredictions;
        int256 credScore;
        uint256 registrationBond;
        uint256 totalStaked;
        uint64 registeredAt;
        bool active;
    }

    uint256 public constant MIN_BOND = 10 ether; // 10 HBAR (HBAR uses 18 decimals on EVM)
    uint256 public nextAgentId = 1;

    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) public ownerToAgent;
    mapping(address => bool) public authorizedCallers;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string name, uint256 bond);
    event AgentDeactivated(uint256 indexed agentId);
    event CredScoreUpdated(uint256 indexed agentId, int256 delta, int256 newScore);
    event AuthorizedCallerSet(address indexed caller, bool authorized);

    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender], "Not authorized");
        _;
    }

    constructor() Ownable(msg.sender) {}

    /// @notice Register a new agent with an HBAR bond
    /// @param name Agent display name
    /// @param description Agent strategy description
    function registerAgent(string calldata name, string calldata description) external payable returns (uint256) {
        require(msg.value >= MIN_BOND, "Bond too low");
        require(ownerToAgent[msg.sender] == 0, "Already registered");
        require(bytes(name).length > 0 && bytes(name).length <= 32, "Invalid name length");

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

    /// @notice Update an agent's credScore after a round resolution
    /// @dev Only callable by authorized contracts (PredictionMarket)
    /// @param agentId The agent to update
    /// @param correct Whether the prediction was correct
    /// @param confidence The confidence value (0-100)
    function updateScore(uint256 agentId, bool correct, uint256 confidence) external onlyAuthorized {
        require(agents[agentId].active, "Agent not active");
        require(confidence <= 100, "Confidence out of range");

        Agent storage agent = agents[agentId];
        agent.totalPredictions++;

        if (correct) {
            agent.correctPredictions++;
            agent.credScore += int256(confidence);
        } else {
            agent.credScore -= int256(confidence);
        }

        int256 delta = correct ? int256(confidence) : -int256(confidence);
        emit CredScoreUpdated(agentId, delta, agent.credScore);
    }

    /// @notice Update the total staked amount for an agent
    /// @dev Only callable by authorized contracts (PredictionMarket)
    function updateTotalStaked(uint256 agentId, int256 delta) external onlyAuthorized {
        require(agents[agentId].active, "Agent not active");
        if (delta > 0) {
            agents[agentId].totalStaked += uint256(delta);
        } else {
            agents[agentId].totalStaked -= uint256(-delta);
        }
    }

    /// @notice Deactivate an agent (only agent owner)
    function deactivateAgent(uint256 agentId) external {
        require(agents[agentId].owner == msg.sender, "Not agent owner");
        require(agents[agentId].active, "Already deactivated");
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    /// @notice Set or revoke authorized caller status
    /// @dev Only callable by contract owner (operator)
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    // ── View Functions ──

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    function getAgentCount() external view returns (uint256) {
        return nextAgentId - 1;
    }

    function isAgentActive(uint256 agentId) external view returns (bool) {
        return agents[agentId].active;
    }
}
