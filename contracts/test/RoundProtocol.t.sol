// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";
import "../src/PredictionMarket.sol";
import "../src/StakingVault.sol";

/// @notice Edge-case tests for the commit-reveal protocol and cross-contract interactions
contract RoundProtocolTest is Test {
    AgentRegistry public registry;
    PredictionMarket public market;
    StakingVault public vault;

    address agent1 = makeAddr("sentinel");
    address agent2 = makeAddr("pulse");
    address agent3 = makeAddr("meridian");
    address agent4 = makeAddr("oracle");
    address outsider = makeAddr("outsider");

    uint256 constant BOND = 10 ether;

    function setUp() public {
        registry = new AgentRegistry();
        market = new PredictionMarket(address(registry));
        vault = new StakingVault(address(registry));

        registry.setAuthorizedCaller(address(market), true);
        registry.setAuthorizedCaller(address(vault), true);

        vm.deal(agent1, 100 ether);
        vm.deal(agent2, 100 ether);
        vm.deal(agent3, 100 ether);
        vm.deal(agent4, 100 ether);
        vm.deal(outsider, 100 ether);

        vm.prank(agent1);
        registry.registerAgent{value: BOND}("Sentinel", "TA");
        vm.prank(agent2);
        registry.registerAgent{value: BOND}("Pulse", "Sentiment");
        vm.prank(agent3);
        registry.registerAgent{value: BOND}("Meridian", "MeanRev");
        vm.prank(agent4);
        registry.registerAgent{value: BOND}("Oracle", "Meta");
    }

    // ── COMMIT EDGE CASES ──

    function test_CannotCommitForUnownedAgent() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        bytes32 hash = keccak256("commit");
        vm.prank(agent2);
        vm.expectRevert("Not agent owner");
        market.commitPrediction(1, 1, hash); // agent2 tries for agent1
    }

    function test_CannotCommitForInactiveAgent() public {
        vm.prank(agent1);
        registry.deactivateAgent(1);
        market.createRound(600, 300, 3600, 321800000000, 0);
        bytes32 hash = keccak256("commit");
        vm.prank(agent1);
        vm.expectRevert("Agent not active");
        market.commitPrediction(1, 1, hash);
    }

    function test_CannotDoubleCommit() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        bytes32 hash = keccak256("commit");
        vm.startPrank(agent1);
        market.commitPrediction(1, 1, hash);
        vm.expectRevert("Already committed");
        market.commitPrediction(1, 1, hash);
        vm.stopPrank();
    }

    function test_EmptyCommitHash() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        vm.prank(agent1);
        vm.expectRevert("Empty commit hash");
        market.commitPrediction(1, 1, bytes32(0));
    }

    // ── REVEAL EDGE CASES ──

    function test_CannotRevealDuringCommitPhase() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        bytes32 salt = bytes32("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint8(0), uint256(70), salt));
        vm.prank(agent1);
        market.commitPrediction(1, 1, hash);

        vm.prank(agent1);
        vm.expectRevert("Not in reveal phase");
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, salt);
    }

    function test_CannotRevealAfterDeadline() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        bytes32 salt = bytes32("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint8(0), uint256(70), salt));
        vm.prank(agent1);
        market.commitPrediction(1, 1, hash);

        vm.warp(block.timestamp + 901);
        vm.prank(agent1);
        vm.expectRevert("Reveal deadline passed");
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, salt);
    }

    function test_CannotRevealWithWrongSalt() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        bytes32 salt = bytes32("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint8(0), uint256(70), salt));
        vm.prank(agent1);
        market.commitPrediction(1, 1, hash);

        vm.warp(block.timestamp + 601);
        vm.prank(agent1);
        vm.expectRevert("Hash mismatch");
        market.revealPrediction(
            1,
            1,
            PredictionMarket.Direction.UP,
            70,
            bytes32("wrong")
        );
    }

    function test_CannotRevealWithoutCommitting() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        vm.warp(block.timestamp + 601);
        vm.prank(agent1);
        vm.expectRevert("Not committed");
        market.revealPrediction(
            1,
            1,
            PredictionMarket.Direction.UP,
            70,
            bytes32("salt")
        );
    }

    function test_ConfidenceMustBe0to100() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        bytes32 salt = bytes32("salt");
        bytes32 hash = keccak256(
            abi.encodePacked(uint8(0), uint256(101), salt)
        );
        vm.prank(agent1);
        market.commitPrediction(1, 1, hash);

        vm.warp(block.timestamp + 601);
        vm.prank(agent1);
        vm.expectRevert("Confidence out of range");
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 101, salt);
    }

    // ── RESOLUTION EDGE CASES ──

    function test_CannotResolveTooEarly() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        vm.warp(block.timestamp + 1000);
        vm.expectRevert("Too early to resolve");
        market.resolveRound(1, 334100000000);
    }

    function test_OnlyOperatorCanResolve() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        vm.warp(block.timestamp + 3601);
        vm.prank(outsider);
        vm.expectRevert();
        market.resolveRound(1, 334100000000);
    }

    function test_CannotResolveAlreadyResolved() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        vm.warp(block.timestamp + 3601);
        market.resolveRound(1, 334100000000);
        vm.expectRevert("Round not active");
        market.resolveRound(1, 334100000000);
    }

    function test_UnrevealedAgentsNotScorable() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        // Agent 1 commits + reveals, Agent 2 only commits
        bytes32 s1 = bytes32("s1");
        vm.prank(agent1);
        market.commitPrediction(
            1,
            1,
            keccak256(abi.encodePacked(uint8(0), uint256(70), s1))
        );
        bytes32 s2 = bytes32("s2");
        vm.prank(agent2);
        market.commitPrediction(
            1,
            2,
            keccak256(abi.encodePacked(uint8(1), uint256(85), s2))
        );

        vm.warp(block.timestamp + 601);
        vm.prank(agent1);
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, s1);
        // Agent 2 doesn't reveal

        vm.warp(block.timestamp + 3600);
        market.resolveRound(1, 334100000000);

        market.claimResult(1, 1); // Works
        vm.expectRevert("Not revealed");
        market.claimResult(1, 2); // Fails — not revealed
    }

    // ── FULL 4-AGENT ROUND (no loops!) ──

    function test_Full4AgentRound_NoLoops() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");
        bytes32 s3 = keccak256("s3");
        bytes32 s4 = keccak256("s4");

        vm.prank(agent1);
        market.commitPrediction(
            1,
            1,
            keccak256(abi.encodePacked(uint8(0), uint256(70), s1))
        );
        vm.prank(agent2);
        market.commitPrediction(
            1,
            2,
            keccak256(abi.encodePacked(uint8(1), uint256(85), s2))
        );
        vm.prank(agent3);
        market.commitPrediction(
            1,
            3,
            keccak256(abi.encodePacked(uint8(0), uint256(50), s3))
        );
        vm.prank(agent4);
        market.commitPrediction(
            1,
            4,
            keccak256(abi.encodePacked(uint8(0), uint256(90), s4))
        );

        vm.warp(block.timestamp + 601);

        vm.prank(agent1);
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, s1);
        vm.prank(agent2);
        market.revealPrediction(1, 2, PredictionMarket.Direction.DOWN, 85, s2);
        vm.prank(agent3);
        market.revealPrediction(1, 3, PredictionMarket.Direction.UP, 50, s3);
        vm.prank(agent4);
        market.revealPrediction(1, 4, PredictionMarket.Direction.UP, 90, s4);

        vm.warp(block.timestamp + 3600);

        // Resolution: O(1) — just sets outcome
        market.resolveRound(1, 334100000000);

        // Score claims: O(1) each — no loop in contract
        market.claimResult(1, 1);
        market.claimResult(1, 2);
        market.claimResult(1, 3);
        market.claimResult(1, 4);

        assertEq(registry.getAgent(1).credScore, int256(70));
        assertEq(registry.getAgent(2).credScore, -int256(85));
        assertEq(registry.getAgent(3).credScore, int256(50));
        assertEq(registry.getAgent(4).credScore, int256(90));
    }

    // ── CANCEL ──

    function test_CancelRound() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        market.cancelRound(1);
        assertTrue(market.isRoundResolved(1) == false);
    }

    function test_CannotCommitToCancelledRound() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        market.cancelRound(1);
        bytes32 hash = keccak256("commit");
        vm.prank(agent1);
        vm.expectRevert("Not in commit phase");
        market.commitPrediction(1, 1, hash);
    }

    // ── SALT SECURITY ──

    function test_SaltPreventsDictionaryAttack() public pure {
        bytes32 salt1 = keccak256("secret1");
        bytes32 salt2 = keccak256("secret2");
        bytes32 hash1 = keccak256(
            abi.encodePacked(uint8(0), uint256(70), salt1)
        );
        bytes32 hash2 = keccak256(
            abi.encodePacked(uint8(0), uint256(70), salt2)
        );
        assertTrue(hash1 != hash2);
    }

    // ── MULTI-ROUND SCORING ──

    function test_MultipleRoundsAccumulateScore() public {
        // Round 1: correct
        market.createRound(600, 300, 3600, 321800000000, 0);
        bytes32 s1 = keccak256("r1");
        vm.prank(agent1);
        market.commitPrediction(
            1,
            1,
            keccak256(abi.encodePacked(uint8(0), uint256(80), s1))
        );
        vm.warp(block.timestamp + 601);
        vm.prank(agent1);
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 80, s1);
        vm.warp(block.timestamp + 3600);
        market.resolveRound(1, 340000000000);
        market.claimResult(1, 1);

        // Round 2: wrong
        market.createRound(600, 300, 3600, 340000000000, 0);
        bytes32 s2 = keccak256("r2");
        vm.prank(agent1);
        market.commitPrediction(
            2,
            1,
            keccak256(abi.encodePacked(uint8(0), uint256(60), s2))
        );
        vm.warp(block.timestamp + 601);
        vm.prank(agent1);
        market.revealPrediction(2, 1, PredictionMarket.Direction.UP, 60, s2);
        vm.warp(block.timestamp + 3600);
        market.resolveRound(2, 320000000000);
        market.claimResult(2, 1);

        // +80 - 60 = +20
        assertEq(registry.getAgent(1).credScore, int256(20));
        assertEq(registry.getAgent(1).totalPredictions, 2);
        assertEq(registry.getAgent(1).correctPredictions, 1);
    }

    // ── CROSS-CONTRACT: Staking + Predictions ──

    function test_StakingDuringRound() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        // Staker stakes on agent1 during commit phase
        vm.prank(makeAddr("staker"));
        vm.deal(makeAddr("staker"), 50 ether);
        vault.stake{value: 10 ether}(1);
        assertEq(vault.getTotalStakedOnAgent(1), 10 ether);

        // Agent1 commits and round continues normally
        bytes32 s = keccak256("s");
        vm.prank(agent1);
        market.commitPrediction(
            1,
            1,
            keccak256(abi.encodePacked(uint8(0), uint256(70), s))
        );
        vm.warp(block.timestamp + 601);
        vm.prank(agent1);
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, s);
        vm.warp(block.timestamp + 3600);
        market.resolveRound(1, 340000000000);
        market.claimResult(1, 1);

        // Agent data shows both staking and prediction data
        AgentRegistry.Agent memory a = registry.getAgent(1);
        assertEq(a.totalStaked, 10 ether);
        assertEq(a.credScore, int256(70));
    }
}
