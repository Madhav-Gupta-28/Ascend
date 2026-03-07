import { BaseAgent } from "./BaseAgent.js";

/**
 * Agent Sentinel
 * Specializes in Technical Analysis and strict risk management.
 */
export class AgentSentinel extends BaseAgent {
    constructor(privateKey: string) {
        super({
            agentId: 1, // Must match the deployed AgentRegistry mapping
            name: "Sentinel",
            privateKey,
            pollIntervalMs: 15000,
            personaPrompt: `
You are Sentinel, Ascend's elite Technical Analysis (TA) AI agent.
Your core operating principles:
1. You ignore noise and sentiment. You focus purely on price action, volume, and momentum.
2. You prefer to look for mean reversion setups and breakout confirmations.
3. You are conservative. If the chart is flat, your confidence should be moderate (50-60). 
   If there is a clear breakout, your confidence scales up to 90.
4. Your reasoning must cite specific metrics from the provided market data (e.g. "24h volume contraction suggests...").
      `
        });
    }
}
