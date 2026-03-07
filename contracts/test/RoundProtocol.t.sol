// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";
import "../src/PredictionMarket.sol";

/// @notice Extended edge-case tests for the commit-reveal prediction protocol
contract RoundProtocolTest is Test {
    AgentRegistry public registry;
    PredictionMarket public market;

    address operator = address(this);
    address agent1 = makeAddr("sentinel");
    address agent2 = makeAddr("pulse");
    address agent3 = makeAddr("meridian");
    address agent4 = makeAddr("oracle");
    address outsider = makeAddr("outsider");

    uint256 constant BOND = 10 ether;

    function setUp() public {
        registry = new AgentRegistry();
        market = new PredictionMarket(address(registry));
        registry.setAuthorizedCaller(address(market), true);

        // Fund and register 4 agents
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

    // ── COMMIT PHASE EDGE CASES ──

    function test_CannotCommitAfterDeadline() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        vm.warp(block.timestamp + 601); // past commit deadline

        bytes32 hash = keccak256(
            abi.encodePacked(uint8(0), uint256(70), bytes32("salt"))
        );
        vm.prank(agent1);
        vm.expectRevert("Commit deadline passed");
        market.commitPrediction(1, 1, hash);
    }

    function test_CannotCommitForUnownedAgent() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 hash = keccak256(
            abi.encodePacked(uint8(0), uint256(70), bytes32("salt"))
        );
        vm.prank(agent2); // agent2 tries to commit for agent1
        vm.expectRevert("Not agent owner");
        market.commitPrediction(1, 1, hash);
    }

    function test_CannotCommitForInactiveAgent() public {
        vm.prank(agent1);
        registry.deactivateAgent(1);

        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 hash = keccak256(
            abi.encodePacked(uint8(0), uint256(70), bytes32("salt"))
        );
        vm.prank(agent1);
        vm.expectRevert("Agent not active");
        market.commitPrediction(1, 1, hash);
    }

    function test_EntryFeeEnforcement() public {
        market.createRound(600, 300, 3600, 321800000000, 1 ether); // 1 HBAR fee

        bytes32 hash = keccak256(
            abi.encodePacked(uint8(0), uint256(70), bytes32("salt"))
        );
        vm.prank(agent1);
        vm.expectRevert("Insufficient entry fee");
        market.commitPrediction{value: 0.5 ether}(1, 1, hash);

        // Works with enough fee
        vm.prank(agent1);
        market.commitPrediction{value: 1 ether}(1, 1, hash);
    }

    // ── REVEAL PHASE EDGE CASES ──

    function test_CannotRevealDuringCommitPhase() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 salt = bytes32("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint8(0), uint256(70), salt));
        vm.prank(agent1);
        market.commitPrediction(1, 1, hash);

        // Try to reveal while still in commit phase
        vm.prank(agent1);
        vm.expectRevert("Commit phase still active");
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, salt);
    }

    function test_CannotRevealAfterDeadline() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 salt = bytes32("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint8(0), uint256(70), salt));
        vm.prank(agent1);
        market.commitPrediction(1, 1, hash);

        vm.warp(block.timestamp + 901); // past reveal deadline (600+300+1)

        vm.prank(agent1);
        vm.expectRevert("Reveal deadline passed");
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, salt);
    }

    function test_CannotRevealWithWrongConfidence() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 salt = bytes32("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint8(0), uint256(70), salt));
        vm.prank(agent1);
        market.commitPrediction(1, 1, hash);

        vm.warp(block.timestamp + 601);

        vm.prank(agent1);
        vm.expectRevert("Hash mismatch");
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 80, salt); // wrong confidence
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
        ); // wrong salt
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

    function test_CannotDoubleReveal() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        bytes32 salt = bytes32("salt");
        bytes32 hash = keccak256(abi.encodePacked(uint8(0), uint256(70), salt));
        vm.prank(agent1);
        market.commitPrediction(1, 1, hash);

        vm.warp(block.timestamp + 601);

        vm.prank(agent1);
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, salt);

        vm.prank(agent1);
        vm.expectRevert("Already revealed");
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, salt);
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

        vm.warp(block.timestamp + 1000); // before resolveAfter (3600s)

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

    function test_UnrevealedAgentsNotScored() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        // Agent 1 commits and reveals
        bytes32 salt1 = bytes32("salt1");
        bytes32 hash1 = keccak256(
            abi.encodePacked(uint8(0), uint256(70), salt1)
        );
        vm.prank(agent1);
        market.commitPrediction(1, 1, hash1);

        // Agent 2 commits but does NOT reveal
        bytes32 salt2 = bytes32("salt2");
        bytes32 hash2 = keccak256(
            abi.encodePacked(uint8(1), uint256(85), salt2)
        );
        vm.prank(agent2);
        market.commitPrediction(1, 2, hash2);

        vm.warp(block.timestamp + 601);

        // Only agent 1 reveals
        vm.prank(agent1);
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, salt1);

        vm.warp(block.timestamp + 3600);
        market.resolveRound(1, 334100000000); // UP

        // Agent 1: scored (correct)
        AgentRegistry.Agent memory a1 = registry.getAgent(1);
        assertEq(a1.totalPredictions, 1);
        assertEq(a1.credScore, int256(70));

        // Agent 2: not scored (didn't reveal)
        AgentRegistry.Agent memory a2 = registry.getAgent(2);
        assertEq(a2.totalPredictions, 0);
        assertEq(a2.credScore, 0);
    }

    // ── FULL 4-AGENT ROUND ──

    function test_Full4AgentRound() public {
        market.createRound(600, 300, 3600, 321800000000, 0);

        // All 4 agents commit
        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");
        bytes32 s3 = keccak256("s3");
        bytes32 s4 = keccak256("s4");

        vm.prank(agent1);
        market.commitPrediction(
            1,
            1,
            keccak256(abi.encodePacked(uint8(0), uint256(70), s1))
        ); // UP
        vm.prank(agent2);
        market.commitPrediction(
            1,
            2,
            keccak256(abi.encodePacked(uint8(1), uint256(85), s2))
        ); // DOWN
        vm.prank(agent3);
        market.commitPrediction(
            1,
            3,
            keccak256(abi.encodePacked(uint8(0), uint256(50), s3))
        ); // UP
        vm.prank(agent4);
        market.commitPrediction(
            1,
            4,
            keccak256(abi.encodePacked(uint8(0), uint256(90), s4))
        ); // UP

        vm.warp(block.timestamp + 601);

        // All 4 reveal
        vm.prank(agent1);
        market.revealPrediction(1, 1, PredictionMarket.Direction.UP, 70, s1);
        vm.prank(agent2);
        market.revealPrediction(1, 2, PredictionMarket.Direction.DOWN, 85, s2);
        vm.prank(agent3);
        market.revealPrediction(1, 3, PredictionMarket.Direction.UP, 50, s3);
        vm.prank(agent4);
        market.revealPrediction(1, 4, PredictionMarket.Direction.UP, 90, s4);

        vm.warp(block.timestamp + 3600);
        market.resolveRound(1, 334100000000); // UP

        // Verify scores
        assertEq(registry.getAgent(1).credScore, int256(70)); // correct UP
        assertEq(registry.getAgent(2).credScore, -int256(85)); // wrong DOWN
        assertEq(registry.getAgent(3).credScore, int256(50)); // correct UP
        assertEq(registry.getAgent(4).credScore, int256(90)); // correct UP

        // Verify round data
        (
            ,
            uint256 ep,
            ,
            ,
            ,
            ,
            PredictionMarket.RoundStatus st,
            uint256 pc
        ) = market.getRound(1);
        assertEq(ep, 334100000000);
        assertEq(uint8(st), uint8(PredictionMarket.RoundStatus.Resolved));
        assertEq(pc, 4);
    }

    // ── CANCEL ROUND ──

    function test_CancelRound() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        market.cancelRound(1);

        (, , , , , , PredictionMarket.RoundStatus status, ) = market.getRound(
            1
        );
        assertEq(uint8(status), uint8(PredictionMarket.RoundStatus.Cancelled));
    }

    function test_CannotCommitToCancelledRound() public {
        market.createRound(600, 300, 3600, 321800000000, 0);
        market.cancelRound(1);

        bytes32 hash = keccak256("commit");
        vm.prank(agent1);
        vm.expectRevert("Not in commit phase");
        market.commitPrediction(1, 1, hash);
    }

    // ── HASH SECURITY ──

    function test_SaltPreventsHashDictionaryAttack() public {
        // Without salt, there are only 202 possible hashes (2 directions × 101 confidence values)
        // With salt, each hash is unique even for the same prediction
        bytes32 salt1 = keccak256("secret1");
        bytes32 salt2 = keccak256("secret2");

        bytes32 hash1 = keccak256(
            abi.encodePacked(uint8(0), uint256(70), salt1)
        );
        bytes32 hash2 = keccak256(
            abi.encodePacked(uint8(0), uint256(70), salt2)
        );

        // Same prediction, different salts → different hashes
        assertTrue(hash1 != hash2);
    }

    // ── MULTIPLE ROUNDS ──

    function test_MultipleSequentialRounds() public {
        // Round 1: agent1 correct
        market.createRound(600, 300, 3600, 321800000000, 0);
        bytes32 s1 = keccak256("r1s1");
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
        market.resolveRound(1, 340000000000); // UP

        // Round 2: agent1 wrong
        market.createRound(600, 300, 3600, 340000000000, 0);
        bytes32 s2 = keccak256("r2s1");
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
        market.resolveRound(2, 320000000000); // DOWN

        // credScore should be +80 - 60 = +20
        assertEq(registry.getAgent(1).credScore, int256(20));
        assertEq(registry.getAgent(1).totalPredictions, 2);
        assertEq(registry.getAgent(1).correctPredictions, 1);
    }
}
