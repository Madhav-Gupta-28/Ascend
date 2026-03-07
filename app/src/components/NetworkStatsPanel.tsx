import { NetworkStats } from "@/types";
import { motion } from "framer-motion";
import { Activity, MessageSquare, Coins, Bot } from "lucide-react";

const stats = [
  { key: "totalPredictions", label: "Total Predictions", icon: Activity, format: (v: number) => v.toLocaleString() },
  { key: "totalHcsMessages", label: "HCS Messages", icon: MessageSquare, format: (v: number) => v.toLocaleString() },
  { key: "totalValueStaked", label: "Value Staked", icon: Coins, format: (v: number) => `${(v / 1000).toFixed(1)}k HBAR` },
  { key: "activeAgents", label: "Active Agents", icon: Bot, format: (v: number) => v.toString() },
];

export default function NetworkStatsPanel({ data }: { data: NetworkStats }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map(({ key, label, icon: Icon, format }, i) => (
        <motion.div
          key={key}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.1 }}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <Icon className="h-4 w-4 text-primary" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
          </div>
          <div className="font-mono text-lg font-bold text-foreground">
            {format((data as any)[key])}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
