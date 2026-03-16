import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Agent } from "@/lib/types";
import { formatHbar } from "@/lib/hedera";
import Link from "next/link";

interface LeaderboardTableProps {
  agents: Agent[];
  loading?: boolean;
  limit?: number;
}

const strategyMap: Record<string, string> = {
  sentinel: "Momentum",
  pulse: "Mean Reversion",
  oracle: "Volatility Arb",
  meridian: "Trend Follow",
};

function formatStake(value: bigint): string {
  const hbar = Number(formatHbar(value));
  return Math.round(hbar).toLocaleString();
}

function strategyFor(agent: Agent): string {
  return strategyMap[agent.name.toLowerCase()] ?? "Statistical Arb";
}

export default function LeaderboardTable({ agents, loading, limit = 4 }: LeaderboardTableProps) {
  const rows = [...agents].sort((a, b) => {
    if (b.credScore !== a.credScore) return b.credScore - a.credScore;
    return b.accuracy - a.accuracy;
  });

  return (
    <Link href="/agents" className="group block">
      <section className="terminal-surface px-4 py-5 transition-colors group-hover:border-secondary/50 md:px-6">
        <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="section-kicker">Ranked Intelligence</p>
            <p className="section-title mt-1">Leaderboard Snapshot</p>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-secondary">
            Open Agents Page →
          </p>
        </div>

        <div className="mt-3">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="h-9 px-3 text-[10px] uppercase tracking-[0.12em]">#</TableHead>
                <TableHead className="h-9 px-3 text-[10px] uppercase tracking-[0.12em]">Agent</TableHead>
                <TableHead className="h-9 px-3 text-[10px] uppercase tracking-[0.12em]">Strategy</TableHead>
                <TableHead className="h-9 px-3 text-right text-[10px] uppercase tracking-[0.12em]">CredScore</TableHead>
                <TableHead className="h-9 px-3 text-right text-[10px] uppercase tracking-[0.12em]">Accuracy</TableHead>
                <TableHead className="h-9 px-3 text-right text-[10px] uppercase tracking-[0.12em]">Predictions</TableHead>
                <TableHead className="h-9 px-3 text-right text-[10px] uppercase tracking-[0.12em]">Staked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    Loading leaderboard...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No active agents yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.slice(0, limit).map((agent, index) => (
                  <TableRow
                    key={agent.id}
                    className={`${index === 0 ? "bg-secondary/10 hover:bg-secondary/10" : "hover:bg-accent/30"} border-border`}
                  >
                    <TableCell className="px-3 py-2 font-mono text-xs text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="px-3 py-2 text-sm font-medium text-foreground">{agent.name}</TableCell>
                    <TableCell className="px-3 py-2 text-sm text-muted-foreground">{strategyFor(agent)}</TableCell>
                    <TableCell className={`px-3 py-2 text-right font-mono text-sm ${agent.credScore >= 0 ? "text-secondary" : "text-destructive"}`}>
                      {agent.credScore.toFixed(1)}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right font-mono text-sm text-foreground">{agent.accuracy.toFixed(1)}%</TableCell>
                    <TableCell className="px-3 py-2 text-right font-mono text-sm text-foreground">{agent.totalPredictions}</TableCell>
                    <TableCell className="px-3 py-2 text-right font-mono text-sm text-foreground">{formatStake(agent.totalStaked)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </Link>
  );
}
