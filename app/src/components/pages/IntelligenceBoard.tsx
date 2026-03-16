"use client";

import { useMemo } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useCurrentRound, useCommitments } from "@/hooks/useRounds";
import { useTotalValueLocked } from "@/hooks/useStaking";
import { useIntelligenceTimeline } from "@/hooks/useIntelligenceTimeline";
import { formatHbar } from "@/lib/hedera";
import ProtocolHero from "@/components/terminal/ProtocolHero";
import SystemMetrics from "@/components/terminal/SystemMetrics";
import MarketPanel from "@/components/terminal/MarketPanel";
import LeaderboardTable from "@/components/terminal/LeaderboardTable";
import ActivityFeed from "@/components/terminal/ActivityFeed";

export default function IntelligenceBoard() {
  const { data: agents = [], isLoading: agentsLoading } = useAgents();
  const { data: round } = useCurrentRound();
  const { data: timelineEvents = [] } = useIntelligenceTimeline(30);
  const { data: tvl = 0n } = useTotalValueLocked();

  const agentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const { data: commitments = {} } = useCommitments(round?.id ?? 0, agentIds, round?.status);

  const metrics = useMemo(() => {
    const agentsActive = agents.filter((agent) => agent.active).length;
    const predictionsLogged = agents.reduce((sum, agent) => sum + agent.totalPredictions, 0);
    const roundsCompleted =
      round == null ? 0 : round.status === 2 || round.status === 3 ? round.id : Math.max(0, round.id - 1);
    const totalHbarStaked = Number(formatHbar(tvl));
    return {
      agentsActive,
      predictionsLogged,
      roundsCompleted,
      totalHbarStaked,
    };
  }, [agents, round, tvl]);

  return (
    <div className="space-y-10 pb-14 md:space-y-14 md:pb-16">
      <ProtocolHero />

      <div className="pt-6 md:pt-8">
        <SystemMetrics
          agentsActive={metrics.agentsActive}
          predictionsLogged={metrics.predictionsLogged}
          roundsCompleted={metrics.roundsCompleted}
          totalHbarStaked={metrics.totalHbarStaked}
        />
      </div>

      <MarketPanel round={round} agents={agents} commitments={commitments} />

      <ActivityFeed events={timelineEvents} />

      <LeaderboardTable agents={agents} loading={agentsLoading} limit={4} />

      <footer className="terminal-surface px-5 py-6 md:px-6 md:py-7">
        <div className="flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Ascend Protocol
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Verifiable Agent Arena
          </p>
        </div>
      </footer>
    </div>
  );
}
