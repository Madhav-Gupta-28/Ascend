/**
 * Ascend — Core module exports
 */

export { ContractClient, createContractClient, loadDeployments } from "./contract-client.js";
export type { AgentData, RoundData, CommitmentData, Deployments } from "./contract-client.js";

export { HCSPublisher, createHCSPublisher } from "./hcs-publisher.js";
export type { ReasoningMessage, ResultMessage, DiscourseMessage, HCSMessage } from "./hcs-publisher.js";

export { DataCollector } from "./data-collector.js";
export type { PriceData, OHLCCandle, MarketData } from "./data-collector.js";

export { MirrorNodeClient } from "./mirror-node-client.js";
export type { DecodedHCSMessage } from "./mirror-node-client.js";

export { RoundOrchestrator } from "./round-orchestrator.js";
export type { AgentPrediction, RoundConfig, AgentProfile } from "./round-orchestrator.js";
