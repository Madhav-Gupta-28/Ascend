import type { Agent, Commitment, Round } from "@/lib/types";
import Link from "next/link";

interface MarketPanelProps {
  round: Round | null | undefined;
  agents: Agent[];
  commitments: Record<number, Commitment>;
}

function roundTimer(round: Round | null | undefined): string {
  if (!round) return "--:--";
  const now = Math.floor(Date.now() / 1000);
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
  fallbackDirection: "UP" | "DOWN";
  fallbackConfidence: number;
}

const presets: ArenaPreset[] = [
  { name: "Pulse", model: "GPT-4 Turbo", fallbackDirection: "UP", fallbackConfidence: 87 },
  { name: "Oracle", model: "Claude 3.5", fallbackDirection: "DOWN", fallbackConfidence: 72 },
  { name: "Meridian", model: "Mistral Large", fallbackDirection: "UP", fallbackConfidence: 64 },
  { name: "Sentinel", model: "Gemini Pro", fallbackDirection: "DOWN", fallbackConfidence: 91 },
];

function directionFromCommitment(commitment: Commitment | undefined, fallback: "UP" | "DOWN"): "UP" | "DOWN" {
  if (!commitment?.revealed) return fallback;
  return commitment.direction === 0 ? "UP" : "DOWN";
}

function confidenceFromCommitment(commitment: Commitment | undefined, fallback: number): number {
  if (!commitment?.revealed) return fallback;
  return commitment.confidence;
}

export default function MarketPanel({ round, agents, commitments }: MarketPanelProps) {
  const fallbackPrice = 0.28417;
  const currentPrice =
    round && round.endPrice > 0 ? round.endPrice : round?.startPrice ?? fallbackPrice;
  const previous = round?.startPrice ?? fallbackPrice * 0.979;
  const pct = previous > 0 ? ((currentPrice - previous) / previous) * 100 : 0;
  const positive = pct >= 0;
  const roundNo = round?.id ?? 842;
  const liveRoundHref = round ? `/round/${roundNo}` : "/round/latest";
  const byName = new Map(agents.map((agent) => [agent.name.toLowerCase(), agent]));

  return (
    <Link
      href={liveRoundHref}
      className="live-arena-shell group block rounded-md border border-border bg-background px-5 py-5 md:px-6 md:py-6"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="section-kicker">Live Intelligence Round</p>
          <p className="section-title mt-1">Live Round Arena</p>
          <p className="mt-3 font-mono text-[13px] uppercase tracking-[0.1em] text-muted-foreground">HBAR / USD</p>
          <p className="mt-1 font-mono text-[34px] font-semibold tracking-tight text-foreground">
            ${currentPrice.toFixed(5)}
          </p>
          <p className={`mt-1 font-mono text-xs ${positive ? "text-secondary" : "text-destructive"}`}>
            {positive ? "+" : ""}
            {pct.toFixed(2)}% 24h
          </p>
        </div>

        <div className="rounded-sm border border-border bg-background px-3 py-2 text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Round #{roundNo} • {roundPhase(round)}
          </p>
          <p className="mt-1 font-mono text-xs text-foreground">
            Resolving in {roundTimer(round)}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary">
            Open Live Arena →
          </p>
        </div>
      </div>

      <div className="mt-4 pt-1">
        <p className="terminal-heading">Agent Predictions — Round #{roundNo}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          {presets.map((preset) => {
            const agent = byName.get(preset.name.toLowerCase());
            const commitment = agent ? commitments[agent.id] : undefined;
            const direction = directionFromCommitment(commitment, preset.fallbackDirection);
            const confidence = confidenceFromCommitment(commitment, preset.fallbackConfidence);
            const up = direction === "UP";
            const barColor = up ? "bg-secondary" : "bg-destructive";

            return (
              <div key={preset.name} className="rounded-sm border border-border bg-background px-3 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{preset.name}</p>
                  <span
                    className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                      up ? "bg-secondary/15 text-secondary" : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {direction}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{preset.model}</p>

                <div className="mt-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    Confidence
                  </span>
                  <span className="font-mono text-xs text-foreground">{confidence}%</span>
                </div>
                <div className="mt-1.5 h-[2px] w-full bg-border">
                  <div className={`h-[2px] ${barColor}`} style={{ width: `${Math.max(0, Math.min(100, confidence))}%` }} />
                </div>

                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  {agent ? `0.0.${agent.id.toString().padStart(6, "0")}` : "0.0.------"}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </Link>
  );
}
