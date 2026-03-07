// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";
import "../src/PredictionMarket.sol";

contract AscendTest is Test {
    AgentRegistry public registry;
    PredictionMarket public market;

    address deployer = address(this);
    address agent1Owner = makeAddr("agent1");
    address agent2Owner = makeAddr("agent2");
    address staker = makeAddr("staker");

    uint256 constant BOND = 10 ether;

    function setUp() public {
        registry = new AgentRegistry();
        market = new PredictionMarket(address(registry));

        // Authorize PredictionMarket to update scores
        registry.setAuthorizedCaller(address(market), true);

        // Fund test accounts
        vm.deal(agent1Owner, 100 ether);
        vm.deal(agent2Owner, 100 ether);
        vm.deal(staker, 100 ether);
    }

    // ── AgentRegistry Tests ──

    function test_RegisterAgent() public {
        vm.prank(agent1Owner);
        uint256 agentId = registry.registerAgent{value: BOND}(
            "Sentinel",
            "Technical analyst"
        );

        assertEq(agentId, 1);
        AgentRegistry.Agent memory agent = registry.getAgent(1);
        assertEq(agent.name, "Sentinel");
        assertEq(agent.owner, agent1Owner);
        assertEq(agent.registrationBond, BOND);
        assertTrue(agent.active);
        assertEq(agent.credScore, 0);
    }

    function test_RegisterAgent_InsufficientBond() public {
        vm.prank(agent1Owner);
        vm.expectRevert("Bond too low");
        registry.registerAgent{value: 1 ether}("Sentinel", "desc");
    }

    function test_RegisterAgent_DoubleRegistration() public {
        vm.startPrank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "desc");
        vm.expectRevert("Already registered");
        registry.registerAgent{value: BOND}("Duplicate", "desc");
        vm.stopPrank();
    }

    function test_DeactivateAgent() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "desc");

        vm.prank(agent1Owner);
        registry.deactivateAgent(1);

        assertFalse(registry.isAgentActive(1));
    }

    function test_UpdateScore_Unauthorized() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "desc");

        vm.prank(agent1Owner); // not authorized
        vm.expectRevert("Not authorized");
        registry.updateScore(1, true, 70);
    }

    // ── PredictionMarket Tests ──

    function test_CreateRound() public {
        uint256 roundId = market.createRound(600, 300, 3600, 321800000000, 0);
        assertEq(roundId, 1);

        (uint256 sp, , , , , , PredictionMarket.RoundStatus status, ) = market
            .getRound(1);
        assertEq(sp, 321800000000);
        assertEq(uint8(status), uint8(PredictionMarket.RoundStatus.Committing));
    }

    function test_FullCommitRevealResolve() public {
        // Setup: register 2 agents
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");
        vm.prank(agent2Owner);
        registry.registerAgent{value: BOND}("Pulse", "Sentiment");

        // Create round: 10 min commit, 5 min reveal, 1 hr duration
        uint256 roundId = market.createRound(600, 300, 3600, 321800000000, 0);

        // Agent 1 commits: UP, confidence 70
        bytes32 salt1 = keccak256("salt1");
        bytes32 hash1 = keccak256(
            abi.encodePacked(uint8(0), uint256(70), salt1)
        ); // UP=0
        vm.prank(agent1Owner);
        market.commitPrediction(roundId, 1, hash1);

        // Agent 2 commits: DOWN, confidence 85
        bytes32 salt2 = keccak256("salt2");
        bytes32 hash2 = keccak256(
            abi.encodePacked(uint8(1), uint256(85), salt2)
        ); // DOWN=1
        vm.prank(agent2Owner);
        market.commitPrediction(roundId, 2, hash2);

        // Advance past commit deadline
        vm.warp(block.timestamp + 601);

        // Agent 1 reveals
        vm.prank(agent1Owner);
        market.revealPrediction(
            roundId,
            1,
            PredictionMarket.Direction.UP,
            70,
            salt1
        );

        // Agent 2 reveals
        vm.prank(agent2Owner);
        market.revealPrediction(
            roundId,
            2,
            PredictionMarket.Direction.DOWN,
            85,
            salt2
        );

        // Advance past resolve time
        vm.warp(block.timestamp + 3600);

        // Resolve: price went UP (end > start)
        market.resolveRound(roundId, 334100000000);

        // Verify scores
        AgentRegistry.Agent memory a1 = registry.getAgent(1);
        assertEq(a1.credScore, int256(70)); // Correct UP prediction
        assertEq(a1.totalPredictions, 1);
        assertEq(a1.correctPredictions, 1);

        AgentRegistry.Agent memory a2 = registry.getAgent(2);
        assertEq(a2.credScore, -int256(85)); // Wrong DOWN prediction
        assertEq(a2.totalPredictions, 1);
        assertEq(a2.correctPredictions, 0);
    }

    function test_CommitReveal_HashMismatch() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 salt = keccak256("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint8(0), uint256(70), salt));
        vm.prank(agent1Owner);
        market.commitPrediction(1, 1, hash);

        vm.warp(block.timestamp + 601);

        // Try to reveal with wrong values
        vm.prank(agent1Owner);
        vm.expectRevert("Hash mismatch");
        market.revealPrediction(
            1,
            1,
            PredictionMarket.Direction.DOWN,
            70,
            salt
        ); // Wrong direction
    }

    function test_DoubleCommit() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 hash = keccak256("commit");
        vm.startPrank(agent1Owner);
        market.commitPrediction(1, 1, hash);
        vm.expectRevert("Already committed");
        market.commitPrediction(1, 1, hash);
        vm.stopPrank();
    }

    // ── Staking Tests ──

    function test_StakeAndUnstake() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        // Stake 5 HBAR
        vm.prank(staker);
        market.stakeOnAgent{value: 5 ether}(1);
        assertEq(market.getUserStake(1, staker), 5 ether);
        assertEq(market.totalAgentStakes(1), 5 ether);

        // Unstake 3 HBAR
        uint256 balBefore = staker.balance;
        vm.prank(staker);
        market.unstake(1, 3 ether);
        assertEq(market.getUserStake(1, staker), 2 ether);
        assertEq(staker.balance, balBefore + 3 ether);
    }

    function test_Unstake_Insufficient() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        vm.prank(staker);
        market.stakeOnAgent{value: 5 ether}(1);

        vm.prank(staker);
        vm.expectRevert("Insufficient stake");
        market.unstake(1, 10 ether);
    }
}
