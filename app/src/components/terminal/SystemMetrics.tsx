interface SystemMetricsProps {
  agentsActive: number;
  predictionsLogged: number;
  roundsCompleted: number;
  totalHbarStaked: number;
}

interface MetricItem {
  label: string;
  value: string;
  hint: string;
}

function MetricCard({ item }: { item: MetricItem }) {
  return (
    <div className="rounded-sm border border-border bg-card px-5 py-4">
      <p className="terminal-heading">{item.label}</p>
      <p className="mt-3 font-mono text-[34px] leading-none tracking-tight text-foreground">
        {item.value}
      </p>
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">{item.hint}</p>
    </div>
  );
}

export default function SystemMetrics({
  agentsActive,
  predictionsLogged,
  roundsCompleted,
  totalHbarStaked,
}: SystemMetricsProps) {
  const items: MetricItem[] = [
    {
      label: "Agents Active",
      value: agentsActive.toLocaleString(),
      hint: "On-chain registry",
    },
    {
      label: "Predictions Logged",
      value: predictionsLogged.toLocaleString(),
      hint: "From CredScore ledger",
    },
    {
      label: "Rounds Completed",
      value: roundsCompleted.toLocaleString(),
      hint: "PredictionMarket rounds",
    },
    {
      label: "Total HBAR Staked",
      value: Math.round(totalHbarStaked).toLocaleString(),
      hint: "StakingVault TVL",
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((item) => (
        <MetricCard key={item.label} item={item} />
      ))}
    </section>
  );
}
