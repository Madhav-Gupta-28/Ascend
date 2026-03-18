import { useEffect, useState } from "react";
import type { Agent, Commitment, Round } from "@/lib/types";
import Link from "next/link";

interface MarketPanelProps {
  round: Round | null | undefined;
  agents: Agent[];
  commitments: Record<number, Commitment>;
  latestEventTimestamp?: string | null;
}

type AgentSignalDirection = "UP" | "DOWN" | "LOCKED" | "PENDING";

function roundTimer(round: Round | null | undefined, now: number | null): string {
  if (!round || now == null) return "--:--";
  const target =
    round.status === 0
      ? round.commitDeadline
      : round.status === 1
        ? round.revealDeadline
        : round.resolveAfter;
  const remaining = Math.max(0, target - now);
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function roundPhase(round: Round | null | undefined): string {
  if (!round) return "OFFLINE";
  if (round.status === 0) return "OPEN";
  if (round.status === 1) return "REVEAL";
  if (round.status === 2) return "RESOLVED";
  return "CANCELLED";
}

interface ArenaPreset {
  name: string;
  model: string;
  agentId: number;
}

function modelFromAgent(agent: Agent): string {
  const summary = (agent.description || "").split(".")[0]?.trim();
  if (summary && summary.length > 0) return summary;
  return "Autonomous strategy model";
}

function signalFromCommitment(commitment: Commitment | undefined): {
  direction: AgentSignalDirection;
  confidence: number | null;
} {
  if (!commitment) return { direction: "PENDING", confidence: null };
  if (commitment.revealed) {
    return {
      direction: commitment.direction === 0 ? "UP" : "DOWN",
      confidence: commitment.confidence,
    };
  }
  if (commitment.committed) return { direction: "LOCKED", confidence: null };
  return { direction: "PENDING", confidence: null };
}

export default function MarketPanel({ round, agents, commitments, latestEventTimestamp = null }: MarketPanelProps) {
  const [nowSec, setNowSec] = useState<number | null>(null);

  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const currentPrice = round && round.endPrice > 0 ? round.endPrice : round?.startPrice ?? null;
  const previous = round?.startPrice ?? null;
  const pct = previous && currentPrice ? ((currentPrice - previous) / previous) * 100 : 0;
  const positive = pct >= 0;
  const roundNo = round?.id ?? null;
  const liveRoundHref = "/round/latest";
  const sortedActiveAgents = [...agents]
    .filter((agent) => agent.active)
    .sort((a, b) => {
      if (b.registeredAt !== a.registeredAt) return b.registeredAt - a.registeredAt;
      return b.id - a.id;
    });
  const participatingAgents = sortedActiveAgents.filter((agent) => {
    const commitment = commitments[agent.id];
    return commitment?.committed || commitment?.revealed;
  });
  const arenaAgents = (participatingAgents.length > 0 ? participatingAgents : sortedActiveAgents)
    .slice(0, 4)
    .map((agent) => ({
      name: agent.name,
      model: modelFromAgent(agent),
      agentId: agent.id,
    })) satisfies ArenaPreset[];
  const activeRoundExists = Boolean(round) && (round?.status === 0 || round?.status === 1);
  const latestEventSec = latestEventTimestamp
    ? Math.floor(new Date(latestEventTimestamp).getTime() / 1000)
    : null;
  const hcsStreaming =
    latestEventSec != null && nowSec != null && nowSec - latestEventSec <= 90;
  const agentsLive = arenaAgents.length > 0;
  const protocolLive = activeRoundExists && hcsStreaming;

  return (
    <Link
      href={liveRoundHref}
      className="live-arena-shell group block rounded-md border border-border bg-background px-5 py-5 md:px-6 md:py-6"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="section-kicker">Live Intelligence Round</p>
          <p className="section-title mt-1">Live Round Arena</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                protocolLive
                  ? "border-secondary/40 bg-secondary/10 text-secondary"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  protocolLive ? "bg-secondary animate-pulse" : "bg-muted-foreground"
                }`}
              />
              LIVE
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                hcsStreaming
                  ? "border-secondary/40 bg-secondary/10 text-secondary"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              HCS Streaming
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                agentsLive
                  ? "border-secondary/40 bg-secondary/10 text-secondary"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              Agents Active
            </span>
          </div>
          <p className="mt-3 font-mono text-[13px] uppercase tracking-[0.1em] text-muted-foreground">HBAR / USD</p>
          <p className="mt-1 font-mono text-[34px] font-semibold tracking-tight text-foreground">
            {currentPrice != null ? `$${currentPrice.toFixed(5)}` : "--"}
          </p>
          {currentPrice != null && previous != null ? (
            <p className={`mt-1 font-mono text-xs ${positive ? "text-secondary" : "text-destructive"}`}>
              {positive ? "+" : ""}
              {pct.toFixed(2)}% vs round open
            </p>
          ) : (
            <p className="mt-1 font-mono text-xs text-muted-foreground">Awaiting active round</p>
          )}
        </div>

        <div className="rounded-sm border border-border bg-background px-3 py-2 text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {roundNo != null ? `Round #${roundNo}` : "No live round"} • {roundPhase(round)}
          </p>
          <p className="mt-1 font-mono text-xs text-foreground">
            Resolving in {roundTimer(round, nowSec)}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary">
            Open Live Arena →
          </p>
        </div>
      </div>

      <div className="mt-4 pt-1">
        <p className="terminal-heading">
          Agent Predictions {roundNo != null ? `— Round #${roundNo}` : ""}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          {arenaAgents.map((preset) => {
            const commitment = commitments[preset.agentId];
            const signal = signalFromCommitment(commitment);
            const up = signal.direction === "UP";
            const down = signal.direction === "DOWN";
            const barColor = up ? "bg-secondary" : down ? "bg-destructive" : "bg-muted-foreground";
            const confidence = signal.confidence ?? 0;

            return (
              <div key={preset.name} className="rounded-sm border border-border bg-background px-3 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{preset.name}</p>
                  <span
                    className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                      up
                        ? "bg-secondary/15 text-secondary"
                        : down
                          ? "bg-destructive/15 text-destructive"
                          : "bg-card text-muted-foreground"
                    }`}
                  >
                    {signal.direction}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{preset.model}</p>

                <div className="mt-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    Confidence
                  </span>
                  <span className="font-mono text-xs text-foreground">
                    {signal.confidence != null ? `${signal.confidence}%` : "—"}
                  </span>
                </div>
                <div className="mt-1.5 h-[2px] w-full bg-border">
                  <div className={`h-[2px] ${barColor}`} style={{ width: `${Math.max(0, Math.min(100, confidence))}%` }} />
                </div>

                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  {`Agent #${preset.agentId}`}
                </p>
              </div>
            );
          })}

          {arenaAgents.length === 0 ? (
            <div className="rounded-sm border border-border bg-background px-3 py-5 md:col-span-4">
              <p className="text-sm text-muted-foreground">No active agents are available for the next round yet.</p>
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
