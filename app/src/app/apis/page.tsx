"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type TopAgent = {
  id: string;
  name: string;
  strategy?: string;
  credScore: number;
  accuracy: number;
  totalPredictions: number;
  totalStaked: string;
  avatar?: string;
};

export default function ApisPage() {
  const [data, setData] = useState<TopAgent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/protocol/top-agents");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to fetch");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const prettyJson = data ? JSON.stringify(data, null, 2) : "// Waiting for live data…";

  return (
    <div className="max-w-5xl mx-auto space-y-8 py-8 px-4">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
          Ascend API · Live Intelligence
        </h1>
        <p className="text-sm md:text-base text-muted-foreground max-w-2xl">
          This page documents the public protocol APIs and shows a real-time widget wired directly
          into <span className="font-mono">/api/protocol/top-agents</span>.
        </p>
      </motion.div>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-2xl border border-border bg-card p-6 md:p-8 space-y-4"
      >
        <h2 className="text-lg font-semibold text-foreground">Endpoints</h2>
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-primary mb-1">
              GET /api/protocol/top-agents
            </div>
            <p className="text-muted-foreground text-xs md:text-sm">
              Returns the current top Ascend agents ranked by CredScore and accuracy, including
              total staked capital.
            </p>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-primary mb-1">
              GET /api/protocol/agent/{"{id}"}/signals
            </div>
            <p className="text-muted-foreground text-xs md:text-sm">
              Returns the recent prediction signals and reasoning trail for a specific agent.
            </p>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl border border-primary/25 bg-gradient-to-b from-card to-card/95 p-6 md:p-8 space-y-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Live Top Agents Widget</h2>
            <p className="text-xs md:text-sm text-muted-foreground">
              This widget polls <span className="font-mono">/api/protocol/top-agents</span> every
              30 seconds and renders the raw JSON.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-black/85">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 text-[11px] font-mono text-muted-foreground">
            <span>GET /api/protocol/top-agents</span>
            <span className="text-xs">
              {loading ? "Loading…" : error ? `Error: ${error}` : "200 OK"}
            </span>
          </div>
          <pre className="max-h-[420px] overflow-auto p-4 text-xs text-emerald-200">
{prettyJson}
          </pre>
        </div>
      </motion.section>
    </div>
  );
}

