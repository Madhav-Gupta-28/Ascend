/**
 * Ascend — Round Orchestrator
 * 
 * Manages the complete prediction round lifecycle:
 * 
 * ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
 * │  CREATED     │───▶│  COMMITTING │───▶│  REVEALING  │───▶│  RESOLVED   │
 * │ fetch price  │    │ agents commit│    │ agents reveal│   │ scores update│
 * │ create round │    │ publish HCS  │    │             │    │ publish result│
 * └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
 * 
 * SECURITY INVARIANTS:
 * 1. Agents commit keccak256(direction, confidence, salt) — hash cannot be reversed
 * 2. Reasoning is published to HCS AFTER commit — prediction is locked on-chain
 * 3. Direction in HCS matches commit hash — verified at reveal time
 * 4. Salt prevents hash dictionary attacks (2×101 = 202 possible direction×confidence combos)
 * 5. Reveal requires hash match — agents cannot change prediction after seeing others
 */

import { ContractClient, type RoundData } from "./contract-client.js";
import { HCSPublisher, type ResultMessage } from "./hcs-publisher.js";
import { DataCollector, type MarketData } from "./data-collector.js";

// ── Types ──

export interface AgentPrediction {
    agentId: number;
    agentName: string;
    direction: 0 | 1; // 0=UP, 1=DOWN
    confidence: number; // 0-100
    reasoning: string;
    salt: string;
    commitHash: string;
}

export interface RoundConfig {
    commitDurationSecs: number;  // How long agents have to commit
    revealDurationSecs: number;  // How long agents have to reveal
    roundDurationSecs: number;   // Total round duration before resolution
    entryFeeHbar: number;        // Entry fee per agent (0 for free)
}

export interface AgentProfile {
    id: number;
    name: string;
    analyze: (data: MarketData) => Promise<{
        direction: "UP" | "DOWN";
        confidence: number;
        reasoning: string;
    }>;
}

// ── Round Lifecycle ──

export class RoundOrchestrator {
    private contracts: ContractClient;
    private hcs: HCSPublisher;
    private dataCollector: DataCollector;
    private agents: AgentProfile[];

    constructor(
        contracts: ContractClient,
        hcs: HCSPublisher,
        dataCollector: DataCollector,
        agents: AgentProfile[]
    ) {
        this.contracts = contracts;
        this.hcs = hcs;
        this.dataCollector = dataCollector;
        this.agents = agents;
    }

    /**
     * Execute a complete prediction round end-to-end.
     * 
     * Returns the round ID and all predictions for logging/debugging.
     */
    async executeRound(config: RoundConfig): Promise<{
        roundId: number;
        predictions: AgentPrediction[];
        startPrice: bigint;
        endPrice: bigint;
        outcome: "UP" | "DOWN";
    }> {
        console.log("\n══════════════════════════════════════");
        console.log("  ROUND STARTING");
        console.log("══════════════════════════════════════");

        // ── STEP 1: Fetch current price ──
        console.log("\n📊 Step 1: Fetching HBAR/USD price...");
        const marketData = await this.dataCollector.collectMarketData();
        const startPrice = DataCollector.priceToContract(marketData.price.currentPrice);
        console.log(`   Price: $${marketData.price.currentPrice} (contract: ${startPrice})`);

        // ── STEP 2: Create round on-chain ──
        console.log("\n📝 Step 2: Creating round on-chain...");
        const roundId = Number(await this.contracts.createRound(
            config.commitDurationSecs,
            config.revealDurationSecs,
            config.roundDurationSecs,
            startPrice,
            config.entryFeeHbar
        ));
        const createdRound = await this.contracts.getRound(roundId);
        console.log(`   Round #${roundId} created`);
        console.log(
            `   Commit window: ${config.commitDurationSecs}s (deadline ${Number(createdRound.commitDeadline)})`,
        );
        console.log(
            `   Reveal window: ${config.revealDurationSecs}s (deadline ${Number(createdRound.revealDeadline)})`,
        );

        // ── STEP 3: Run all agents — generate predictions ──
        console.log("\n🤖 Step 3: Running agent analyses...");
        const predictions: AgentPrediction[] = [];

        const publishThinking = process.env.ASCEND_PUBLISH_THINKING === "true";
        for (const agent of this.agents) {
            try {
                console.log(`   [${agent.name}] Analyzing...`);

                if (publishThinking) {
                    void this.hcs
                        .publishThinking(
                            roundId,
                            agent.name,
                            `${agent.name} is fetching market data and scanning technical indicators...`,
                        )
                        .catch((error) => {
                            console.error(
                                `   [${agent.name}] ⚠️ Thinking publish failed: ${
                                    (error as Error).message
                                }`,
                            );
                        });
                }

                const result = await agent.analyze(marketData);
                const direction = result.direction === "UP" ? 0 : 1;

                // Generate cryptographic salt
                const salt = ContractClient.generateSalt();
                const commitHash = ContractClient.computeCommitHash(direction, result.confidence, salt);

                predictions.push({
                    agentId: agent.id,
                    agentName: agent.name,
                    direction: direction as 0 | 1,
                    confidence: result.confidence,
                    reasoning: result.reasoning,
                    salt,
                    commitHash,
                });

                console.log(`   [${agent.name}] → ${result.direction} (${result.confidence}%)`);
            } catch (error: any) {
                console.error(`   [${agent.name}] ❌ Analysis failed: ${error.message}`);
            }
        }

        if (predictions.length === 0) {
            await this.resolveRoundWithoutParticipants(
                roundId,
                createdRound,
                startPrice,
                "No agents produced predictions",
            );
            throw new Error("No agents produced predictions — round resolved in safety mode");
        }

        // ── STEP 4: Commit all predictions on-chain (FCFS participants) ──
        console.log("\n🔒 Step 4: Committing predictions on-chain...");
        console.log(
            `   Commit headroom: ${Number(createdRound.commitDeadline) - Math.floor(Date.now() / 1000)}s`,
        );
        const pendingCommitTxs: Array<{
            pred: AgentPrediction;
            tx: import("ethers").ContractTransactionResponse;
        }> = [];
        const committedPredictions: AgentPrediction[] = [];
        for (const pred of predictions) {
            if (Math.floor(Date.now() / 1000) > Number(createdRound.commitDeadline)) {
                console.warn(
                    `   [${pred.agentName}] ⚠️ Skipping commit because commit deadline is already closed`,
                );
                continue;
            }
            try {
                const txPromise = this.contracts.commitPredictionTx(
                    roundId,
                    pred.agentId,
                    pred.commitHash,
                    config.entryFeeHbar,
                );
                const tx = await txPromise;
                pendingCommitTxs.push({ pred, tx });
                console.log(`   [${pred.agentName}] Commit submitted`);
            } catch (error: any) {
                console.error(`   [${pred.agentName}] ❌ Commit failed: ${error.message}`);
            }
        }

        for (const pending of pendingCommitTxs) {
            try {
                await pending.tx.wait();
                committedPredictions.push(pending.pred);
                console.log(
                    `   [${pending.pred.agentName}] Committed: ${pending.pred.commitHash.substring(0, 10)}...`,
                );
            } catch (error: any) {
                const message = error?.message || String(error);
                let committedOnChain = false;
                try {
                    const commitment = await this.contracts.getCommitment(
                        roundId,
                        pending.pred.agentId,
                    );
                    committedOnChain = commitment.committed;
                } catch {
                    // ignore and treat as failure
                }

                if (committedOnChain) {
                    committedPredictions.push(pending.pred);
                    console.log(
                        `   [${pending.pred.agentName}] Commit confirmed via on-chain state after tx confirmation error`,
                    );
                } else {
                    console.error(
                        `   [${pending.pred.agentName}] ❌ Commit confirmation failed: ${message}`,
                    );
                }
            }
        }

        if (committedPredictions.length === 0) {
            await this.resolveRoundWithoutParticipants(
                roundId,
                createdRound,
                startPrice,
                "No successful commits",
            );
            throw new Error("No successful commits in this round — round resolved in safety mode");
        }

        // ── STEP 5: Publish reasoning to HCS (AFTER commit) ──
        // This is the critical security moment: reasoning is only published
        // AFTER the prediction hash is locked on-chain. Direction is intentionally
        // withheld here to avoid leaking the prediction before reveal.
        console.log("\n📡 Step 5: Publishing reasoning to HCS...");
        for (const pred of committedPredictions) {
            try {
                const { sequenceNumber } = await this.hcs.publishReasoning(
                    roundId,
                    pred.agentName.toLowerCase(),
                    undefined,
                    pred.confidence,
                    pred.reasoning
                );
                console.log(`   [${pred.agentName}] HCS msg #${sequenceNumber}`);
            } catch (error: any) {
                console.error(`   [${pred.agentName}] ❌ HCS publish failed: ${error.message}`);
            }
        }

        // ── STEP 6: Wait for commit phase to end ──
        const waitForCommitCloseMs = Math.max(
            0,
            Number(createdRound.commitDeadline) * 1000 - Date.now() + 200,
        );
        if (waitForCommitCloseMs > 0) {
            console.log(
                `\n⏳ Step 6: Waiting ${Math.ceil(waitForCommitCloseMs / 1000)}s for commit phase to end...`,
            );
            await this.sleep(waitForCommitCloseMs);
        }

        // ── STEP 7: Reveal all predictions ──
        console.log("\n🔓 Step 7: Revealing predictions on-chain...");
        const pendingRevealTxs: Array<{
            pred: AgentPrediction;
            tx: import("ethers").ContractTransactionResponse;
        }> = [];
        const revealedPredictions: AgentPrediction[] = [];
        for (const pred of committedPredictions) {
            try {
                const txPromise = this.contracts.revealPredictionTx(
                    roundId,
                    pred.agentId,
                    pred.direction,
                    pred.confidence,
                    pred.salt
                );
                const tx = await txPromise;
                pendingRevealTxs.push({ pred, tx });
                console.log(
                    `   [${pred.agentName}] Reveal submitted: ${pred.direction === 0 ? "UP" : "DOWN"} @ ${pred.confidence}%`,
                );
            } catch (error: any) {
                console.error(`   [${pred.agentName}] ❌ Reveal failed: ${error.message}`);
            }
        }

        for (const pending of pendingRevealTxs) {
            try {
                await pending.tx.wait();
                revealedPredictions.push(pending.pred);
                console.log(
                    `   [${pending.pred.agentName}] Revealed: ${
                        pending.pred.direction === 0 ? "UP" : "DOWN"
                    } @ ${pending.pred.confidence}%`,
                );
            } catch (error: any) {
                const message = error?.message || String(error);
                let revealedOnChain = false;
                try {
                    const commitment = await this.contracts.getCommitment(
                        roundId,
                        pending.pred.agentId,
                    );
                    revealedOnChain = commitment.revealed;
                } catch {
                    // ignore
                }

                if (!revealedOnChain && Math.floor(Date.now() / 1000) <= Number(createdRound.revealDeadline)) {
                    try {
                        await this.contracts.revealPrediction(
                            roundId,
                            pending.pred.agentId,
                            pending.pred.direction,
                            pending.pred.confidence,
                            pending.pred.salt,
                        );
                        revealedOnChain = true;
                        console.log(
                            `   [${pending.pred.agentName}] Reveal recovered on retry`,
                        );
                    } catch (retryError: any) {
                        console.error(
                            `   [${pending.pred.agentName}] ❌ Reveal retry failed: ${
                                retryError?.message || String(retryError)
                            }`,
                        );
                    }
                }

                if (revealedOnChain) {
                    revealedPredictions.push(pending.pred);
                } else {
                    console.error(
                        `   [${pending.pred.agentName}] ❌ Reveal confirmation failed: ${message}`,
                    );
                }
            }
        }

        // ── STEP 8: Wait for round duration to complete ──
        const latestRound = await this.contracts.getRound(roundId);
        const waitForResolutionMs = Math.max(
            0,
            Number(latestRound.resolveAfter) * 1000 - Date.now() + 200,
        );
        if (waitForResolutionMs > 0) {
            console.log(
                `\n⏳ Step 8: Waiting ${Math.ceil(waitForResolutionMs / 1000)}s for round to end...`,
            );
            await this.sleep(waitForResolutionMs);
        }

        // ── STEP 9: Fetch end price and resolve ──
        console.log("\n📊 Step 9: Fetching end price and resolving...");
        const endData = await this.dataCollector.collectMarketData();
        const endPrice = DataCollector.priceToContract(endData.price.currentPrice);
        const outcome: "UP" | "DOWN" = endPrice >= startPrice ? "UP" : "DOWN";

        console.log(`   Start: $${DataCollector.contractToPrice(startPrice)}`);
        console.log(`   End:   $${endData.price.currentPrice}`);
        console.log(`   Outcome: ${outcome}`);

        await this.resolveRoundWithRetry(roundId, endPrice);
        console.log(`   ✅ Round #${roundId} resolved on-chain`);

        // ── STEP 9.5: Claim results for score updates (O(1) per agent) ──
        console.log("\n🧮 Step 9.5: Claiming per-agent round results...");
        for (const pred of revealedPredictions) {
            try {
                await this.contracts.claimResult(roundId, pred.agentId);
                console.log(`   [${pred.agentName}] Score claimed`);
            } catch (error: any) {
                const message = error?.message || String(error);
                let scoredOnChain = false;
                try {
                    const commitment = await this.contracts.getCommitment(roundId, pred.agentId);
                    scoredOnChain = commitment.scored;
                } catch {
                    // ignore
                }

                if (!scoredOnChain) {
                    try {
                        await this.contracts.claimResult(roundId, pred.agentId);
                        scoredOnChain = true;
                        console.log(`   [${pred.agentName}] Score claim recovered on retry`);
                    } catch (retryError: any) {
                        console.error(
                            `   [${pred.agentName}] ❌ Claim retry failed: ${
                                retryError?.message || String(retryError)
                            }`,
                        );
                    }
                }

                if (!scoredOnChain) {
                    console.error(`   [${pred.agentName}] ❌ Claim failed: ${message}`);
                }
            }
        }

        // ── STEP 10: Publish result to HCS ──
        console.log("\n📡 Step 10: Publishing result to HCS...");
        const scores: ResultMessage["scores"] = revealedPredictions.map((pred) => {
            const correct = (pred.direction === 0 ? "UP" : "DOWN") === outcome;
            return {
                agentId: pred.agentName.toLowerCase(),
                correct,
                credScoreDelta: correct ? pred.confidence : -pred.confidence,
            };
        });

        await this.hcs.publishResult(
            roundId,
            Number(startPrice),
            Number(endPrice),
            outcome,
            scores
        );

        // ── STEP 11: Reward Distribution (70% stakers, 20% agent operator, 10% treasury) ──
        console.log("\n💰 Step 11: Distributing staking rewards...");
        const winners = revealedPredictions.filter(
            (p) => (p.direction === 0 ? "UP" : "DOWN") === outcome,
        );
        let onchainRound: Awaited<ReturnType<typeof this.contracts.getRound>>;
        let rewardPoolBefore: bigint;
        try {
            onchainRound = await this.contracts.getRound(roundId);
            rewardPoolBefore = await this.contracts.getRoundRewardPool(roundId);
        } catch (rpcErr: any) {
            console.warn(`   ⚠️ RPC error reading round data for reward distribution (non-fatal): ${rpcErr.message}`);
            console.log("\n══════════════════════════════════════");
            console.log(`  ROUND #${roundId} COMPLETE — Outcome: ${outcome} (rewards skipped)`);
            console.log("══════════════════════════════════════");
            return { roundId, predictions: revealedPredictions, startPrice, endPrice, outcome };
        }
        const participantCount = onchainRound.participantCount;
        const losersCount = Math.max(0, participantCount - winners.length);
        const treasuryAddress = process.env.ASCEND_TREASURY_ADDRESS?.trim();

        if (rewardPoolBefore === 0n || participantCount === 0) {
            console.log("   No reward pool funds available for this round.");
        } else {
            // Pull funds from PredictionMarket so distribution is sourced from round fees.
            await this.contracts.withdrawRewardPool(roundId, rewardPoolBefore);
            console.log(
                `   Withdrew ${this.formatTinybarAsHbar(rewardPoolBefore)} from PredictionMarket.rewardPool`,
            );

            let protocolRemainder = rewardPoolBefore;

            if (winners.length > 0 && losersCount > 0) {
                // Forfeited share comes from incorrect participants, scaled from actual pool.
                const forfeitedPool =
                    (rewardPoolBefore * BigInt(losersCount)) / BigInt(participantCount);
                const perWinner = forfeitedPool / BigInt(winners.length);
                const stakerCutPerWinner = (perWinner * 70n) / 100n;
                const operatorCutPerWinner = (perWinner * 20n) / 100n;
                const treasuryCutPerWinner = (perWinner * 10n) / 100n;

                for (const winner of winners) {
                    try {
                        const totalStakedOnWinner = await this.contracts.getTotalStakedOnAgentRaw(
                            winner.agentId,
                        );
                        if (stakerCutPerWinner > 0n && totalStakedOnWinner > 0n) {
                            await this.contracts.depositRewardRaw(
                                winner.agentId,
                                stakerCutPerWinner,
                            );
                            protocolRemainder -= stakerCutPerWinner;
                            console.log(
                                `   [${winner.agentName}] Routed ${this.formatTinybarAsHbar(stakerCutPerWinner)} to Staking Vault`,
                            );
                        } else if (stakerCutPerWinner > 0n) {
                            console.log(
                                `   [${winner.agentName}] No active stakers; staker share retained for protocol sweep`,
                            );
                        }
                    } catch (err: any) {
                        console.error(
                            `   [${winner.agentName}] ❌ Failed to route staker share: ${err.message}`,
                        );
                    }

                    if (operatorCutPerWinner > 0n) {
                        try {
                            const owner = (await this.contracts.getAgent(winner.agentId)).owner;
                            await this.contracts.transferRaw(owner, operatorCutPerWinner);
                            protocolRemainder -= operatorCutPerWinner;
                            console.log(
                                `   [${winner.agentName}] Routed ${this.formatTinybarAsHbar(operatorCutPerWinner)} to agent operator`,
                            );
                        } catch (err: any) {
                            console.error(
                                `   [${winner.agentName}] ❌ Failed to transfer operator cut: ${err.message}`,
                            );
                        }
                    }

                    if (treasuryCutPerWinner > 0n && treasuryAddress) {
                        try {
                            await this.contracts.transferRaw(
                                treasuryAddress,
                                treasuryCutPerWinner,
                            );
                            protocolRemainder -= treasuryCutPerWinner;
                        } catch (err: any) {
                            console.error(
                                `   [Treasury] ❌ Failed to transfer winner treasury cut: ${err.message}`,
                            );
                        }
                    }
                }
            } else {
                console.log(
                    "   No forfeited pool to split (either no winners or no losers).",
                );
            }

            if (protocolRemainder > 0n) {
                if (treasuryAddress) {
                    try {
                        await this.contracts.transferRaw(treasuryAddress, protocolRemainder);
                        console.log(
                            `   [Treasury] Routed protocol remainder ${this.formatTinybarAsHbar(protocolRemainder)} (${treasuryAddress})`,
                        );
                        protocolRemainder = 0n;
                    } catch (err: any) {
                        console.error(
                            `   [Treasury] ❌ Failed to transfer protocol remainder: ${err.message}`,
                        );
                    }
                } else {
                    console.log(
                        `   [Treasury] ASCEND_TREASURY_ADDRESS not set; protocol remainder kept by operator (${this.formatTinybarAsHbar(protocolRemainder)})`,
                    );
                }
            }
        }

        // ── DONE ──
        console.log("\n══════════════════════════════════════");
        console.log(`  ROUND #${roundId} COMPLETE — Outcome: ${outcome}`);
        console.log("══════════════════════════════════════");

        for (const pred of committedPredictions) {
            const correct = (pred.direction === 0 ? "UP" : "DOWN") === outcome;
            console.log(`  ${correct ? "✅" : "❌"} ${pred.agentName}: ${pred.direction === 0 ? "UP" : "DOWN"} @ ${pred.confidence}% → ${correct ? "+" : "-"}${pred.confidence} credScore`);
        }

        return { roundId, predictions: revealedPredictions, startPrice, endPrice, outcome };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private formatTinybarAsHbar(value: bigint): string {
        const negative = value < 0n;
        const abs = negative ? -value : value;
        const whole = abs / 100_000_000n;
        const fraction = (abs % 100_000_000n).toString().padStart(8, "0");
        return `${negative ? "-" : ""}${whole}.${fraction} HBAR`;
    }

    private async resolveRoundWithRetry(roundId: number, endPrice: bigint): Promise<void> {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.contracts.resolveRound(roundId, endPrice);
                return;
            } catch (error: any) {
                let alreadyResolved = false;
                try {
                    alreadyResolved = await this.contracts.isRoundResolved(roundId);
                } catch {
                    // ignore read failures during retries
                }

                if (alreadyResolved) {
                    console.log(`   ⚠️ Round #${roundId} already resolved on-chain (detected during retry)`);
                    return;
                }

                if (attempt === maxAttempts) {
                    throw error;
                }

                console.warn(
                    `   ⚠️ Resolve attempt ${attempt}/${maxAttempts} failed; retrying... (${error?.message || String(error)})`,
                );
                await this.sleep(1500 * attempt);
            }
        }
    }

    private async resolveRoundWithoutParticipants(
        roundId: number,
        createdRound: RoundData,
        startPrice: bigint,
        reason: string,
    ): Promise<void> {
        console.warn(`   ⚠️ Safety mode engaged for round #${roundId}: ${reason}`);

        const waitForResolutionMs = Math.max(
            0,
            Number(createdRound.resolveAfter) * 1000 - Date.now() + 200,
        );
        if (waitForResolutionMs > 0) {
            console.log(
                `   ⏳ Waiting ${Math.ceil(waitForResolutionMs / 1000)}s before safety resolution...`,
            );
            await this.sleep(waitForResolutionMs);
        }

        const endData = await this.dataCollector.collectMarketData();
        const endPrice = DataCollector.priceToContract(endData.price.currentPrice);
        const outcome: "UP" | "DOWN" = endPrice >= startPrice ? "UP" : "DOWN";

        await this.resolveRoundWithRetry(roundId, endPrice);
        console.log(`   ✅ Round #${roundId} resolved in safety mode`);

        try {
            await this.hcs.publishResult(
                roundId,
                Number(startPrice),
                Number(endPrice),
                outcome,
                [],
            );
            console.log("   📡 Published empty-result safety payload to HCS");
        } catch (error: any) {
            console.error(
                `   ⚠️ Failed to publish safety result payload: ${error?.message || String(error)}`,
            );
        }
    }
}
