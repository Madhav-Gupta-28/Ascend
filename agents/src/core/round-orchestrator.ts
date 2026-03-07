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
        console.log(`   Round #${roundId} created`);
        console.log(`   Commit window: ${config.commitDurationSecs}s`);
        console.log(`   Reveal window: ${config.revealDurationSecs}s`);

        // ── STEP 3: Run all agents — generate predictions ──
        console.log("\n🤖 Step 3: Running agent analyses...");
        const predictions: AgentPrediction[] = [];

        for (const agent of this.agents) {
            try {
                console.log(`   [${agent.name}] Analyzing...`);
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
            throw new Error("No agents produced predictions — cannot continue round");
        }

        // ── STEP 4: Commit all predictions on-chain ──
        console.log("\n🔒 Step 4: Committing predictions on-chain...");
        for (const pred of predictions) {
            try {
                await this.contracts.commitPrediction(roundId, pred.agentId, pred.commitHash, config.entryFeeHbar);
                console.log(`   [${pred.agentName}] Committed: ${pred.commitHash.substring(0, 10)}...`);
            } catch (error: any) {
                console.error(`   [${pred.agentName}] ❌ Commit failed: ${error.message}`);
            }
        }

        // ── STEP 5: Publish reasoning to HCS (AFTER commit) ──
        // This is the critical security moment: reasoning is only published
        // AFTER the prediction hash is locked on-chain. The hash cannot be changed.
        console.log("\n📡 Step 5: Publishing reasoning to HCS...");
        for (const pred of predictions) {
            try {
                const { sequenceNumber } = await this.hcs.publishReasoning(
                    roundId,
                    pred.agentName.toLowerCase(),
                    pred.direction === 0 ? "UP" : "DOWN",
                    pred.confidence,
                    pred.reasoning
                );
                console.log(`   [${pred.agentName}] HCS msg #${sequenceNumber}`);
            } catch (error: any) {
                console.error(`   [${pred.agentName}] ❌ HCS publish failed: ${error.message}`);
            }
        }

        // ── STEP 6: Wait for commit phase to end ──
        console.log(`\n⏳ Step 6: Waiting ${config.commitDurationSecs}s for commit phase to end...`);
        await this.sleep(config.commitDurationSecs * 1000 + 2000); // +2s buffer

        // ── STEP 7: Reveal all predictions ──
        console.log("\n🔓 Step 7: Revealing predictions on-chain...");
        for (const pred of predictions) {
            try {
                await this.contracts.revealPrediction(
                    roundId,
                    pred.agentId,
                    pred.direction,
                    pred.confidence,
                    pred.salt
                );
                console.log(`   [${pred.agentName}] Revealed: ${pred.direction === 0 ? "UP" : "DOWN"} @ ${pred.confidence}%`);
            } catch (error: any) {
                console.error(`   [${pred.agentName}] ❌ Reveal failed: ${error.message}`);
            }
        }

        // ── STEP 8: Wait for round duration to complete ──
        const remainingWait = Math.max(0, config.roundDurationSecs - config.commitDurationSecs - config.revealDurationSecs);
        if (remainingWait > 0) {
            console.log(`\n⏳ Step 8: Waiting ${remainingWait}s for round to end...`);
            await this.sleep(remainingWait * 1000 + 2000);
        }

        // ── STEP 9: Fetch end price and resolve ──
        console.log("\n📊 Step 9: Fetching end price and resolving...");
        const endData = await this.dataCollector.collectMarketData();
        const endPrice = DataCollector.priceToContract(endData.price.currentPrice);
        const outcome: "UP" | "DOWN" = endPrice >= startPrice ? "UP" : "DOWN";

        console.log(`   Start: $${DataCollector.contractToPrice(startPrice)}`);
        console.log(`   End:   $${endData.price.currentPrice}`);
        console.log(`   Outcome: ${outcome}`);

        await this.contracts.resolveRound(roundId, endPrice);
        console.log(`   ✅ Round #${roundId} resolved on-chain`);

        // ── STEP 10: Publish result to HCS ──
        console.log("\n📡 Step 10: Publishing result to HCS...");
        const scores: ResultMessage["scores"] = predictions.map((pred) => {
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

        // ── STEP 11: Reward Distribution (Operator routing 20% cut) ──
        console.log("\n💰 Step 11: Distributing staking rewards...");
        const correctAgents = predictions.filter(p => (p.direction === 0 ? "UP" : "DOWN") === outcome);
        const incorrectAgents = predictions.filter(p => (p.direction === 0 ? "UP" : "DOWN") !== outcome);

        if (correctAgents.length > 0 && incorrectAgents.length > 0 && config.entryFeeHbar > 0) {
            // Total forfeited HBAR from incorrect agents
            const totalForfeited = incorrectAgents.length * config.entryFeeHbar;
            // Split equally among correct agents
            const profitPerWinner = totalForfeited / correctAgents.length;
            // Staking Vault cut: 20% of the profit
            const stakerCutPerWinner = profitPerWinner * 0.20;

            for (const winner of correctAgents) {
                try {
                    await this.contracts.depositReward(winner.agentId, stakerCutPerWinner.toString());
                    console.log(`   [${winner.agentName}] Routed ${stakerCutPerWinner.toFixed(4)} HBAR to Staking Vault`);
                } catch (err: any) {
                    console.error(`   [${winner.agentName}] ❌ Failed to route reward: ${err.message}`);
                }
            }
        } else {
            console.log("   No rewards to route (either no winners, no losers, or free round).");
        }

        // ── DONE ──
        console.log("\n══════════════════════════════════════");
        console.log(`  ROUND #${roundId} COMPLETE — Outcome: ${outcome}`);
        console.log("══════════════════════════════════════");

        for (const pred of predictions) {
            const correct = (pred.direction === 0 ? "UP" : "DOWN") === outcome;
            console.log(`  ${correct ? "✅" : "❌"} ${pred.agentName}: ${pred.direction === 0 ? "UP" : "DOWN"} @ ${pred.confidence}% → ${correct ? "+" : "-"}${pred.confidence} credScore`);
        }

        return { roundId, predictions, startPrice, endPrice, outcome };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
