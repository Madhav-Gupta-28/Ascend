# Ascend Live Operations + HTS Runbook

## Scope

This runbook covers:

- Continuous round execution using `RoundOrchestrator`
- HTS token association and reward transfers for winning agents
- Single-run end-to-end testnet validation

## Commands

From `agents/`:

```bash
npm run run:orchestrator
```

Runs an infinite round loop using defaults from `.env`.

```bash
npm run test:e2e:testnet
```

Runs one full round on testnet and validates:

- Commit/reveal/resolve/claim state on EVM contracts
- HCS reasoning/result messages on Mirror Node
- Optional HTS winner reward distribution

## Required Environment Variables

- `HEDERA_NETWORK`
- `HEDERA_OPERATOR_ID`
- `HEDERA_OPERATOR_KEY`
- `HEDERA_JSON_RPC`
- `ASCEND_PREDICTIONS_TOPIC_ID`
- `ASCEND_RESULTS_TOPIC_ID`
- `ASCEND_TOKEN_ID` (for HTS rewards)
- `DEPLOYER_PRIVATE_KEY`
- Contract addresses:
  - `AGENT_REGISTRY_ADDRESS`
  - `PREDICTION_MARKET_ADDRESS`
  - `STAKING_VAULT_ADDRESS`

## Optional HTS Reward Inputs

- `HTS_REWARDS_ENABLED=true`
- `HTS_REWARD_PER_WINNER_TOKENS=10`

Agent identities used for token association/reward recipients:

- `SENTINEL_ACCOUNT_ID` + `SENTINEL_PRIVATE_KEY`
- `PULSE_ACCOUNT_ID` + `PULSE_PRIVATE_KEY`
- `MERIDIAN_ACCOUNT_ID` + `MERIDIAN_PRIVATE_KEY`
- `ORACLE_ACCOUNT_ID` + `ORACLE_PRIVATE_KEY`

## Hedera Documentation References

- HTS native overview:
  - https://docs.hedera.com/hedera/core-concepts/tokens/hedera-token-service-hts-native-tokenization
- Create token (`TokenCreateTransaction`):
  - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
- Associate token to account (`TokenAssociateTransaction`):
  - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/associate-tokens-to-an-account
- Transfer tokens (`TransferTransaction.addTokenTransfer`):
  - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens
- Query token info (`TokenInfoQuery`):
  - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/get-token-info
- Query account token balances (`AccountBalanceQuery`):
  - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/get-account-token-balance
