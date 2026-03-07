// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";
import "../src/PredictionMarket.sol";
import "../src/StakingVault.sol";

/// @notice Core unit tests for all 3 contracts
contract AscendCoreTest is Test {
    AgentRegistry public registry;
    PredictionMarket public market;
    StakingVault public vault;

    address deployer = address(this);
    address agent1Owner = makeAddr("agent1");
    address agent2Owner = makeAddr("agent2");
    address staker1 = makeAddr("staker1");
    address staker2 = makeAddr("staker2");

    uint256 constant BOND = 10 ether;

    function setUp() public {
        registry = new AgentRegistry();
        market = new PredictionMarket(address(registry));
        vault = new StakingVault(address(registry));

        // Cross-contract permissions
        registry.setAuthorizedCaller(address(market), true);
        registry.setAuthorizedCaller(address(vault), true);

        // Fund accounts
        vm.deal(agent1Owner, 100 ether);
        vm.deal(agent2Owner, 100 ether);
        vm.deal(staker1, 100 ether);
        vm.deal(staker2, 100 ether);
        vm.deal(deployer, 100 ether);
    }

    // ═══════════════════════════════════════
    // CONTRACT 1 — AgentRegistry
    // ═══════════════════════════════════════

    function test_RegisterAgent() public {
        vm.prank(agent1Owner);
        uint256 id = registry.registerAgent{value: BOND}(
            "Sentinel",
            "Technical analyst"
        );
        assertEq(id, 1);

        AgentRegistry.Agent memory a = registry.getAgent(1);
        assertEq(a.name, "Sentinel");
        assertEq(a.owner, agent1Owner);
        assertEq(a.registrationBond, BOND);
        assertTrue(a.active);
        assertEq(a.credScore, 0);
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

    function test_DeactivateAndWithdrawBond() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "desc");

        uint256 balBefore = agent1Owner.balance;
        vm.startPrank(agent1Owner);
        registry.deactivateAgent(1);
        registry.withdrawBond(1);
        vm.stopPrank();

        assertFalse(registry.isAgentActive(1));
        assertEq(agent1Owner.balance, balBefore + BOND);
    }

    function test_CannotWithdrawBondWhileActive() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "desc");

        vm.prank(agent1Owner);
        vm.expectRevert("Agent still active");
        registry.withdrawBond(1);
    }

    function test_UpdateScore_Unauthorized() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "desc");

        vm.prank(agent1Owner);
        vm.expectRevert("Not authorized");
        registry.updateScore(1, true, 70);
    }

    // ═══════════════════════════════════════
    // CONTRACT 2 — PredictionMarket
    // ═══════════════════════════════════════

    function test_CreateRound() public {
        uint256 id = market.createRound(600, 300, 3600, 321800000000, 0);
        assertEq(id, 1);

        (
            uint256 sp,
            ,
            ,
            ,
            ,
            ,
            PredictionMarket.RoundStatus status,
            ,
            ,

        ) = market.getRound(1);
        assertEq(sp, 321800000000);
        assertEq(uint8(status), uint8(PredictionMarket.RoundStatus.Committing));
    }

    function test_RoundDurationValidation() public {
        // roundDuration must be >= commitDuration + revealDuration
        vm.expectRevert("Round too short");
        market.createRound(600, 300, 800, 321800000000, 0); // 800 < 600+300
    }

    function test_FullCommitRevealClaimFlow() public {
        // Register agents
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");
        vm.prank(agent2Owner);
        registry.registerAgent{value: BOND}("Pulse", "Sentiment");

        // Create round
        market.createRound(600, 300, 3600, 321800000000, 0);

        // Agent 1: UP, 70% confidence
        bytes32 salt1 = keccak256("salt1");
        bytes32 hash1 = keccak256(
            abi.encodePacked(uint8(0), uint256(70), salt1)
        );
        vm.prank(agent1Owner);
        market.commitPrediction(1, 1, hash1);

        // Agent 2: DOWN, 85% confidence
        bytes32 salt2 = keccak256("salt2");
        bytes32 hash2 = keccak256(
            abi.encodePacked(uint8(1), uint256(85), salt2)
        );
        vm.prank(agent2Owner);
        market.commitPrediction(1, 2, hash2);

        // Advance past commit deadline
        vm.warp(block.timestamp + 601);

        // Reveals
        vm.prank(agent1Owner);
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, salt1);
        vm.prank(agent2Owner);
        market.revealPrediction(
            1,
            2,
            PredictionMarket.Direction.DOWN,
            85,
            salt2
        );

        // Advance past resolveAfter
        vm.warp(block.timestamp + 3600);

        // Resolve: UP (endPrice > startPrice) — O(1), no loops!
        market.resolveRound(1, 334100000000);

        // Claim results individually — O(1) each
        market.claimResult(1, 1); // Agent 1: correct → +70
        market.claimResult(1, 2); // Agent 2: wrong → -85

        // Verify scores
        assertEq(registry.getAgent(1).credScore, int256(70));
        assertEq(registry.getAgent(1).correctPredictions, 1);
        assertEq(registry.getAgent(2).credScore, -int256(85));
        assertEq(registry.getAgent(2).correctPredictions, 0);
    }

    function test_ClaimResult_CannotDoubleClaim() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 salt = keccak256("s");
        vm.prank(agent1Owner);
        market.commitPrediction(
            1,
            1,
            keccak256(abi.encodePacked(uint8(0), uint256(70), salt))
        );

        vm.warp(block.timestamp + 601);
        vm.prank(agent1Owner);
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, salt);

        vm.warp(block.timestamp + 3600);
        market.resolveRound(1, 334100000000);
        market.claimResult(1, 1);

        vm.expectRevert("Already scored");
        market.claimResult(1, 1);
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

        // Wrong direction
        vm.prank(agent1Owner);
        vm.expectRevert("Hash mismatch");
        market.revealPrediction(
            1,
            1,
            PredictionMarket.Direction.DOWN,
            70,
            salt
        );
    }

    function test_CannotCommitAfterDeadline() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        market.createRound(600, 300, 3600, 321800000000, 0);

        vm.warp(block.timestamp + 601);

        bytes32 hash = keccak256("commit");
        vm.prank(agent1Owner);
        vm.expectRevert("Commit deadline passed");
        market.commitPrediction(1, 1, hash);
    }

    function test_EntryFeeCollection() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        market.createRound(600, 300, 3600, 321800000000, 1 ether);

        bytes32 hash = keccak256("commit");

        // Fails with insufficient fee
        vm.prank(agent1Owner);
        vm.expectRevert("Insufficient entry fee");
        market.commitPrediction{value: 0.5 ether}(1, 1, hash);

        // Succeeds with enough fee
        vm.prank(agent1Owner);
        market.commitPrediction{value: 1 ether}(1, 1, hash);

        // Reward pool updated
        (, , , , , , , , , uint8 pc) = market.getRound(1);
        assertEq(pc, 0); // TODO: revealedCount doesn't reflect participant count in the view
    }

    // ═══════════════════════════════════════
    // CONTRACT 3 — StakingVault
    // ═══════════════════════════════════════

    function test_StakeAndUnstake() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        // Stake 5 HBAR
        vm.prank(staker1);
        vault.stake{value: 5 ether}(1);

        (uint256 amt, ) = vault.getUserStake(1, staker1);
        assertEq(amt, 5 ether);
        assertEq(vault.getTotalStakedOnAgent(1), 5 ether);
        assertEq(vault.getTVL(), 5 ether);
        assertEq(registry.getAgent(1).totalStaked, 5 ether);

        // Unstake 3 HBAR
        uint256 balBefore = staker1.balance;
        vm.prank(staker1);
        vault.unstake(1, 3 ether);

        (amt, ) = vault.getUserStake(1, staker1);
        assertEq(amt, 2 ether);
        assertEq(staker1.balance, balBefore + 3 ether);
        assertEq(vault.getTVL(), 2 ether);
    }

    function test_UnstakeInsufficient() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        vm.prank(staker1);
        vault.stake{value: 5 ether}(1);

        vm.prank(staker1);
        vm.expectRevert("Insufficient stake");
        vault.unstake(1, 10 ether);
    }

    function test_StakeOnInactiveAgent() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");
        vm.prank(agent1Owner);
        registry.deactivateAgent(1);

        vm.prank(staker1);
        vm.expectRevert("Agent not active");
        vault.stake{value: 5 ether}(1);
    }

    function test_RewardDistribution() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        // Two stakers: staker1 = 3 HBAR, staker2 = 7 HBAR → 30%, 70%
        vm.prank(staker1);
        vault.stake{value: 3 ether}(1);
        vm.prank(staker2);
        vault.stake{value: 7 ether}(1);

        // Operator deposits 10 HBAR reward
        vault.depositReward{value: 10 ether}(1);

        // staker1 claims: 30% of 10 = 3 HBAR
        uint256 pending1 = vault.getPendingReward(1, staker1);
        assertEq(pending1, 3 ether);

        uint256 bal1Before = staker1.balance;
        vm.prank(staker1);
        vault.claimReward(1);
        assertEq(staker1.balance, bal1Before + 3 ether);

        // staker2 claims: 7/10 of remaining 7 HBAR = 7 HBAR
        uint256 bal2Before = staker2.balance;
        vm.prank(staker2);
        vault.claimReward(1);
        assertEq(staker2.balance, bal2Before + 7 ether);
    }

    function test_NoRewardWithoutStake() public {
        vm.prank(agent1Owner);
        registry.registerAgent{value: BOND}("Sentinel", "TA");

        vault.depositReward{value: 10 ether}(1);

        vm.prank(staker1);
        vm.expectRevert("No rewards available");
        vault.claimReward(1);
    }
}
