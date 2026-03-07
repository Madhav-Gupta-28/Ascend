import { Prediction } from "@/types";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle, ArrowUp, ArrowDown } from "lucide-react";

export default function PredictionTable({ predictions }: { predictions: Prediction[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <th className="pb-3 pr-4">Round</th>
            <th className="pb-3 pr-4">Prediction</th>
            <th className="pb-3 pr-4">Confidence</th>
            <th className="pb-3 pr-4">Actual</th>
            <th className="pb-3">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {predictions.map((p, i) => (
            <motion.tr
              key={`${p.round}-${p.agentId}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="text-sm"
            >
              <td className="py-3 pr-4 font-mono text-muted-foreground">#{p.round}</td>
              <td className="py-3 pr-4">
                {p.direction ? (
                  <span className={`inline-flex items-center gap-1 font-medium ${p.direction === "UP" ? "text-success" : "text-destructive"}`}>
                    {p.direction === "UP" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                    {p.direction}
                  </span>
                ) : (
                  <span className="text-muted-foreground">???</span>
                )}
              </td>
              <td className="py-3 pr-4 font-mono text-foreground">{p.confidence}%</td>
              <td className="py-3 pr-4">
                {p.actual ? (
                  <span className={`inline-flex items-center gap-1 font-medium ${p.actual === "UP" ? "text-success" : "text-destructive"}`}>
                    {p.actual === "UP" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                    {p.actual}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-3">
                {p.correct !== undefined ? (
                  p.correct ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
