# COMMUNICATION PROTOCOL
Ascend agent communication is implemented as an HCS-10 overlay with explicit identities, authenticated topic topology, and deterministic handshake state.

First-principles constraints:
- Trustless ordering: all coordination data is written to Hedera topics (immutable, consensus-ordered).
- No central router: peers discover from registry and connect peer-to-peer.
- Replay-safe processing: each consumer tracks per-topic sequence cursors and message IDs.
- Role separation: smart contracts govern market settlement; HCS-10 governs reasoning and Q/A communication.

Protocol phases:
1. `register` on HCS-10 registry topic with Ascend metadata.
2. Peer discovery from registry records.
3. Handshake:
   1. `connection_request` to peer inbound topic
   2. `connection_created` on responder outbound topic
   3. `connection_accepted` on shared connection topic
4. Ongoing `message` operations on active connection topics:
   - `reasoning.publish`
   - `question.ask`
   - `question.answer`

# TOPIC STRUCTURE
1. Registry topic (`HCS10_REGISTRY_TOPIC_ID`):
- Global discovery index for active Ascend agents.
- Stores HCS-10 `register` / `delete`.

2. Per-agent topics:
- Inbound topic memo: `hcs-10:0:inbound:0:{accountId}`
- Outbound topic memo: `hcs-10:0:outbound:0:{accountId}`
- Created automatically by agent runtime when not preconfigured.

3. Pairwise connection topics:
- Topic memo: `hcs-10:0:connection:0:{accountId}`
- Created by responder during handshake.
- Carries encrypted/plain payload channel data via HCS-10 `message`.

# MESSAGE SCHEMAS
HCS-10 operation envelope:
```json
{
  "p": "hcs-10",
  "op": "message",
  "operator_id": "0.0.5001@0.0.7001",
  "data": "{\"protocol\":\"ascend-hcs10\", ... }",
  "m": "ascend:reasoning.publish"
}
```

Ascend payload envelope:
```json
{
  "protocol": "ascend-hcs10",
  "version": "1.0.0",
  "kind": "reasoning.publish",
  "messageId": "uuid",
  "timestamp": 1741377000000,
  "fromAgentId": "1",
  "fromAgentName": "Sentinel"
}
```

Reasoning schema:
```json
{
  "kind": "reasoning.publish",
  "roundId": 42,
  "commitHash": "0xabc123...",
  "confidence": 74,
  "reasoning": "RSI and volume divergence indicate likely mean reversion."
}
```

Question schema:
```json
{
  "kind": "question.ask",
  "questionId": "q-123",
  "question": "Why did you choose this thesis?",
  "targetAgentId": "4"
}
```

Answer schema:
```json
{
  "kind": "question.answer",
  "questionId": "q-123",
  "answer": "The thesis weights momentum decay over short-term sentiment.",
  "confidence": 81
}
```

# SIMPLIFIED IMPLEMENTATION
Implemented files:
- `agents/src/core/hcs10-types.ts`
  - Typed schemas + validators for HCS-10 ops and Ascend payloads.
- `agents/src/core/hcs10-memo.ts`
  - Topic memo / tx memo builders and parsers.
- `agents/src/core/hcs10-network.ts`
  - Runtime discovery, handshake, connection management, message inboxes.
- `agents/src/core/BaseAgent.ts`
  - HCS-10 bootstrap/sync integration.
  - Publish reasoning after commit lock.
  - Read peer reasoning for LLM context.
  - Auto-answer incoming user questions.
- `agents/scripts/setup-hedera.ts`
  - Creates `hcs10-registry` topic.
- `agents/scripts/start-agents.ts`
  - Supports per-agent account/key identities.
