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

export { BaseAgent } from "./BaseAgent.js";
export type { AgentConfig, AgentState } from "./BaseAgent.js";
export { AgentSentinel } from "./AgentSentinel.js";
export { AgentMeridian } from "./AgentMeridian.js";
export { AgentOracle } from "./AgentOracle.js";

export { LeaderboardService } from "./leaderboard-service.js";
export type { RankedAgent } from "./leaderboard-service.js";

export { HCS10CommunicationNetwork } from "./hcs10-network.js";
export type {
    HCS10NetworkConfig,
    ReasoningInboxItem,
    QuestionInboxItem,
    AnswerInboxItem,
} from "./hcs10-network.js";

export {
    HCS10_PROTOCOL,
    HCS10_VERSION,
    ASCEND_HCS10_PROTOCOL,
    ASCEND_HCS10_VERSION,
    parseHCS10Operation,
    parseAscendPayload,
} from "./hcs10-types.js";
export type {
    HCS10Operation,
    ReasoningPublishPayload,
    QuestionAskPayload,
    QuestionAnswerPayload,
    AscendPayload,
    AscendAgentMetadata,
} from "./hcs10-types.js";

export {
    buildOperatorId,
    buildTopicMemo,
    buildConnectionRequestTxMemo,
    buildConnectionCreatedTxMemo,
    buildConnectionAcceptedTxMemo,
    parseOperatorId,
} from "./hcs10-memo.js";

export { HTSClient, createHTSClient } from "./hts-client.js";
export type { HtsTokenInfo, RewardRecipient } from "./hts-client.js";

export {
    HederaAgentKitClient,
    createHederaAgentKitFromEnv,
    DEFAULT_HEDERA_AGENT_KIT_TOOLS,
} from "./hedera-agent-kit.js";
export type { HederaAgentKitConfig, HederaAgentKitResult } from "./hedera-agent-kit.js";
