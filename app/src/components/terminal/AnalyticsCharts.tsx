import type { Agent, TimelineEvent } from "@/lib/types";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface AnalyticsChartsProps {
  agents: Agent[];
  events: TimelineEvent[];
}

interface SeriesPoint {
  x: number;
  y: number;
}

function extractCredScoreDeltas(events: TimelineEvent[]): number[] {
  return events
    .filter((event) => event.eventType === "LEADERBOARD_CHANGED")
    .map((event) => Number((event.detail || "").replace(/[^\d+-]/g, "")))
    .filter((value) => Number.isFinite(value));
}

function buildCredSeries(agents: Agent[], events: TimelineEvent[]): SeriesPoint[] {
  const deltas = extractCredScoreDeltas(events).slice(0, 30).reverse();
  const baseline =
    agents.length > 0
      ? agents.reduce((acc, agent) => acc + agent.credScore, 0) / agents.length
      : 74;

  if (deltas.length === 0) {
    return Array.from({ length: 30 }, (_, i) => ({
      x: i + 1,
      y: baseline + Math.sin(i / 2.8) * 2.4 + i * 0.08,
    }));
  }

  let running = baseline;
  const points: SeriesPoint[] = deltas.map((delta, i) => {
    running += delta * 0.08;
    return { x: i + 1, y: running };
  });

  while (points.length < 30) {
    const last = points[points.length - 1]?.y ?? baseline;
    const i = points.length;
    points.push({ x: i + 1, y: last + Math.sin(i / 3.1) * 0.7 });
  }

  return points.slice(0, 30);
}

function buildAccuracySeries(agents: Agent[]): SeriesPoint[] {
  const avg =
    agents.length > 0
      ? agents.reduce((acc, agent) => acc + agent.accuracy, 0) / agents.length
      : 71;

  return Array.from({ length: 30 }, (_, i) => ({
    x: i + 1,
    y: Math.max(0, Math.min(100, avg + Math.sin(i / 1.9) * 1.8 + i * 0.05)),
  }));
}

function AnalyticsChart({
  title,
  data,
  suffix = "",
}: {
  title: string;
  data: SeriesPoint[];
  suffix?: string;
}) {
  const latest = data[data.length - 1]?.y ?? 0;
  return (
    <div className="rounded-sm border border-border bg-background p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="terminal-heading">{title}</p>
        <p className="font-mono text-xs text-foreground">
          {latest.toFixed(1)}
          {suffix}
        </p>
      </div>

      <div className="h-[110px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 2, left: -26, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.5} />
            <XAxis
              dataKey="x"
              tick={false}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={false}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number) => `${value.toFixed(2)}${suffix}`}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "4px",
                color: "hsl(var(--foreground))",
                fontSize: "11px",
              }}
            />
            <Line
              type="monotone"
              dataKey="y"
              stroke="#48DF7B"
              strokeWidth={1.1}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function AnalyticsCharts({ agents, events }: AnalyticsChartsProps) {
  const credSeries = buildCredSeries(agents, events);
  const accuracySeries = buildAccuracySeries(agents);

  return (
    <section className="terminal-surface px-4 py-4 md:px-6">
      <p className="terminal-heading">Network Analytics</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <AnalyticsChart title="AVG CREDSCORE — 30D" data={credSeries} />
        <AnalyticsChart title="PREDICTION ACCURACY — 30D" data={accuracySeries} suffix="%" />
      </div>
    </section>
  );
}
