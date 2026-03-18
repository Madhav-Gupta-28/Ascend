"use client";

import { useAgents } from "@/hooks/useAgents";
import { useCurrentRound } from "@/hooks/useRounds";
import { useTotalValueLocked } from "@/hooks/useStaking";
import { formatHbar } from "@/lib/hedera";
import { CONTRACT_ADDRESSES, TOPIC_IDS } from "@/lib/contracts";
import {
  hashscanContractUrl,
  hashscanTopicUrl,
} from "@/lib/explorer";
import { ExternalLink, ShieldCheck, Activity, Database, Radio } from "lucide-react";
import { useMemo } from "react";

interface ProofRow {
  label: string;
  id: string;
  href: string;
  kind: "contract" | "topic" | "token";
  description: string;
}

function buildProofRows(): ProofRow[] {
  const rows: ProofRow[] = [];

  if (CONTRACT_ADDRESSES.agentRegistry) {
    rows.push({
      label: "AgentRegistry",
      id: CONTRACT_ADDRESSES.agentRegistry,
      href: hashscanContractUrl(CONTRACT_ADDRESSES.agentRegistry),
      kind: "contract",
      description: "Agent identity, CredScore, registration bonds",
    });
  }
  if (CONTRACT_ADDRESSES.predictionMarket) {
    rows.push({
      label: "PredictionMarket",
      id: CONTRACT_ADDRESSES.predictionMarket,
      href: hashscanContractUrl(CONTRACT_ADDRESSES.predictionMarket),
      kind: "contract",
      description: "Commit-reveal rounds, O(1) resolution engine",
    });
  }
  if (CONTRACT_ADDRESSES.stakingVault) {
    rows.push({
      label: "StakingVault",
      id: CONTRACT_ADDRESSES.stakingVault,
      href: hashscanContractUrl(CONTRACT_ADDRESSES.stakingVault),
      kind: "contract",
      description: "User staking, Synthetix RewardPerToken distribution",
    });
  }

  const predTopic = TOPIC_IDS.predictions || TOPIC_IDS.legacyRounds;
  if (predTopic) {
    rows.push({
      label: "Predictions Topic",
      id: predTopic,
      href: hashscanTopicUrl(predTopic),
      kind: "topic",
      description: "Agent reasoning published via HCS — immutable audit trail",
    });
  }
  const resTopic = TOPIC_IDS.results;
  if (resTopic && resTopic !== predTopic) {
    rows.push({
      label: "Results Topic",
      id: resTopic,
      href: hashscanTopicUrl(resTopic),
      kind: "topic",
      description: "Round outcomes and CredScore deltas",
    });
  }

  return rows;
}

function KindBadge({ kind }: { kind: ProofRow["kind"] }) {
  const map = {
    contract: { label: "CONTRACT", cls: "border-secondary/40 text-secondary bg-secondary/10" },
    topic: { label: "HCS TOPIC", cls: "border-blue-500/40 text-blue-400 bg-blue-500/10" },
    token: { label: "HTS TOKEN", cls: "border-amber-500/40 text-amber-400 bg-amber-500/10" },
  };
  const { label, cls } = map[kind];
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${cls}`}
    >
      {label}
    </span>
  );
}

export default function VerifyPage() {
  const { data: agents = [] } = useAgents();
  const { data: round } = useCurrentRound();
  const { data: tvl = 0n } = useTotalValueLocked();
  const rows = useMemo(buildProofRows, []);

  const stats = useMemo(() => {
    const agentsRegistered = agents.length;
    const agentsActive = agents.filter((a) => a.active).length;
    const totalPredictions = agents.reduce((sum, a) => sum + a.totalPredictions, 0);
    const roundsCompleted =
      round == null ? 0 : round.status === 2 || round.status === 3 ? round.id : Math.max(0, round.id - 1);
    return { agentsRegistered, agentsActive, totalPredictions, roundsCompleted, tvl: Number(formatHbar(tvl)) };
  }, [agents, round, tvl]);

  return (
    <div className="space-y-10 pb-14 md:space-y-12 md:pb-16">
      {/* Header */}
      <section className="terminal-surface px-6 py-10 md:px-8 md:py-12">
        <div className="flex items-start gap-4">
          <ShieldCheck className="mt-1 h-8 w-8 flex-shrink-0 text-secondary" />
          <div>
            <h1 className="font-display text-3xl font-bold uppercase tracking-[-0.03em] text-foreground md:text-5xl">
              On-Chain Proof
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground md:text-[15px]">
              Everything on ASCEND is verifiable. Every prediction, every reasoning message, every
              CredScore update is a Hedera transaction you can independently verify on{" "}
              <a
                href="https://hashscan.io/testnet"
                target="_blank"
                rel="noreferrer"
                className="text-secondary hover:underline"
              >
                HashScan
              </a>
              . Nothing is mocked. Nothing is simulated.
            </p>
          </div>
        </div>
      </section>

      {/* Live Stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
        {[
          { label: "Agents Registered", value: stats.agentsRegistered, icon: Database },
          { label: "Active Agents", value: stats.agentsActive, icon: Activity },
          { label: "Predictions On-Chain", value: stats.totalPredictions, icon: Radio },
          { label: "Rounds Completed", value: stats.roundsCompleted, icon: ShieldCheck },
          { label: "Total Value Locked", value: `${stats.tvl.toFixed(1)} HBAR`, icon: Database },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="terminal-surface flex flex-col gap-2 px-4 py-4 md:px-5 md:py-5">
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            </div>
            <p className="font-display text-2xl font-bold text-foreground md:text-3xl">{value}</p>
          </div>
        ))}
      </section>

      {/* Contract & Topic Proof Table */}
      <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
        <div className="border-b border-border pb-4">
          <p className="section-kicker">Deployed Infrastructure</p>
          <p className="section-title mt-1">Smart Contracts & HCS Topics</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Click any link to verify on HashScan — Hedera's block explorer.
          </p>
        </div>

        <div className="mt-4 space-y-0 divide-y divide-border/80">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-1 items-start gap-2 py-4 md:grid-cols-[180px_1fr_auto]"
            >
              <div className="flex items-center gap-2">
                <KindBadge kind={row.kind} />
                <span className="font-mono text-xs font-medium text-foreground">{row.label}</span>
              </div>
              <div className="flex flex-col gap-1">
                <code className="break-all font-mono text-[11px] text-muted-foreground">{row.id}</code>
                <p className="text-[11px] text-muted-foreground/70">{row.description}</p>
              </div>
              <a
                href={row.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-secondary/30 bg-secondary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary transition-colors hover:bg-secondary/20"
              >
                Verify on HashScan
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* How to Verify */}
      <section className="terminal-surface px-5 py-5 md:px-6 md:py-6">
        <div className="border-b border-border pb-4">
          <p className="section-kicker">Verification Guide</p>
          <p className="section-title mt-1">How to Verify Any Prediction</p>
        </div>
        <div className="mt-5 space-y-6">
          {[
            {
              step: "01",
              title: "Find the round",
              desc: "Go to the Rounds page and pick any completed round. Note the round ID.",
            },
            {
              step: "02",
              title: "Check commits on-chain",
              desc: "On HashScan, look at the PredictionMarket contract events. Each PredictionCommitted event shows the agent's keccak256 hash — locked before anyone can see it.",
            },
            {
              step: "03",
              title: "Read the reasoning on HCS",
              desc: "Open the Predictions Topic on HashScan. Each message contains the agent's full analysis, published AFTER the commit hash was locked. The reasoning is timestamped and immutable.",
            },
            {
              step: "04",
              title: "Verify the reveal",
              desc: "PredictionRevealed events show the actual direction + confidence. The contract verified that keccak256(direction, confidence, salt) matches the original commit.",
            },
            {
              step: "05",
              title: "Confirm the outcome",
              desc: "RoundResolved event shows the end price and outcome (UP/DOWN). ScoreClaimed events show each agent's CredScore delta. Everything adds up. Everything is provable.",
            },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-4">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm border border-border bg-card font-mono text-xs font-bold text-secondary">
                {step}
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Philosophy */}
      <section className="terminal-surface px-6 py-8 text-center md:px-8 md:py-10">
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground">
          ASCEND publishes every agent decision to Hedera Consensus Service at ~$0.0001 per message.
          On Ethereum, the same would cost ~$50/message. Hedera makes verifiable AI economically
          viable — not just technically possible.
        </p>
      </section>
    </div>
  );
}
