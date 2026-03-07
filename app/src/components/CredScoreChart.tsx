import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

interface CredScoreChartProps {
  data: number[];
  height?: number;
  showAxis?: boolean;
}

export default function CredScoreChart({ data, height = 200, showAxis = true }: CredScoreChartProps) {
  const chartData = data.map((value, index) => ({ round: index + 1, score: value }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: showAxis ? 0 : -30 }}>
        <defs>
          <linearGradient id="credGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(265, 90%, 65%)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="hsl(265, 90%, 65%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {showAxis && (
          <>
            <XAxis dataKey="round" tick={{ fontSize: 11, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} />
          </>
        )}
        <Tooltip
          contentStyle={{
            background: "hsl(240,12%,10%)",
            border: "1px solid hsl(240,10%,20%)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "hsl(220,20%,92%)",
          }}
          labelFormatter={(v) => `Round ${v}`}
        />
        <Area type="monotone" dataKey="score" stroke="hsl(265,90%,65%)" strokeWidth={2} fill="url(#credGradient)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
