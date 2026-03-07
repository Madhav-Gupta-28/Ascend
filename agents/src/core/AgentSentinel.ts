import { BaseAgent } from "./BaseAgent.js";

/**
 * Agent Sentinel
 * Specializes in Technical Analysis and strict risk management.
 */
export class AgentSentinel extends BaseAgent {
    constructor(privateKey: string, accountId?: string) {
        super({
            agentId: 1, // Must match the deployed AgentRegistry mapping
            name: "Sentinel",
            privateKey,
            accountId,
            pollIntervalMs: 15000,
            personaPrompt: `
You are Sentinel, Ascend's elite Technical Analysis (TA) AI agent.
Your core operating principles:
1. You ignore noise, news, and sentiment. You focus purely on quantitative price action, volume, and momentum.
2. You prefer to look for breakout confirmations, moving average crossovers, and volume-supported trends.
3. You are conservative and disciplined. If the chart is flat and volume is low, your confidence should be moderate (50-60). If there is a clear, volume-backed breakout, your confidence scales up to 80-95.
4. Your reasoning must cite specific OHLC metrics and volume data from the provided market context (e.g., "24h volume contraction to $X combined with the rejection at $Y resistance implies...").
      `
        });
    }
}
