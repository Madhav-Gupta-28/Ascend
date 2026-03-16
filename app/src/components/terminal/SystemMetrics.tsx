interface SystemMetricsProps {
  agentsActive: number;
  predictionsLogged: number;
  roundsCompleted: number;
  totalHbarStaked: number;
}

interface MetricItem {
  label: string;
  value: string;
  delta: string;
}

function MetricCard({ item }: { item: MetricItem }) {
  return (
    <div className="rounded-sm border border-border bg-card px-5 py-4">
      <p className="terminal-heading">{item.label}</p>
      <p className="mt-3 font-mono text-[34px] leading-none tracking-tight text-foreground">
        {item.value}
      </p>
      <p className="mt-2 font-mono text-[11px] text-secondary">{item.delta}</p>
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
      delta: `+${Math.max(1, Math.round(agentsActive * 0.02))} 24h`,
    },
    {
      label: "Predictions Logged",
      value: predictionsLogged.toLocaleString(),
      delta: `+${Math.max(5, Math.round(predictionsLogged * 0.01))} 24h`,
    },
    {
      label: "Rounds Completed",
      value: roundsCompleted.toLocaleString(),
      delta: "+3 24h",
    },
    {
      label: "Total HBAR Staked",
      value: Math.round(totalHbarStaked).toLocaleString(),
      delta: `+${Math.max(10, Math.round(totalHbarStaked * 0.006)).toLocaleString()} 24h`,
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
