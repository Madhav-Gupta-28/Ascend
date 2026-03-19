"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  BarChart3,
  Brain,
  Copy,
  Check,
  ArrowRight,
  ExternalLink,
  Play,
} from "lucide-react";

/* ─── Copy button ─── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* noop */ }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-black/30 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ─── Interactive Try-It widget ─── */
function TryItWidget() {
  const [data, setData] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [responseTime, setResponseTime] = useState(0);

  async function runRequest() {
    try {
      setLoading(true);
      setError(null);
      const t0 = performance.now();
      const res = await fetch("/api/protocol/top-agents");
      const elapsed = Math.round(performance.now() - t0);
      setResponseTime(elapsed);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setHasRun(true);
    } catch (e: any) {
      setError(e?.message || "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }

  // auto-run on mount
  useEffect(() => { runRequest(); }, []);

  const prettyJson = data ? JSON.stringify(data, null, 2) : null;

  return (
    <div className="space-y-3">
      {/* URL bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 rounded-lg border border-border bg-black/60 px-3 py-2.5">
          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
            GET
          </span>
          <span className="font-mono text-xs text-foreground/80 truncate">
            /api/protocol/top-agents
          </span>
        </div>
        <button
          type="button"
          onClick={runRequest}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Send
        </button>
      </div>

      {/* Response */}
      <div className="overflow-hidden rounded-lg border border-border/70 bg-black/80">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
          <div className="flex items-center gap-3">
            {hasRun && !error && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                200 OK
              </span>
            )}
            {error && (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-400">
                ERROR
              </span>
            )}
            {hasRun && !error && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {responseTime}ms
              </span>
            )}
          </div>
          {prettyJson && <CopyBtn text={prettyJson} />}
        </div>
        <pre className="max-h-[350px] overflow-auto p-4 text-[11px] leading-relaxed text-emerald-200/90">
          {loading && !data
            ? "// Sending request…"
            : error
            ? `// Error: ${error}`
            : prettyJson || "// Click Send to try the API"}
        </pre>
      </div>
    </div>
  );
}

/* ─── Endpoint Card ─── */
function EndpointCard({
  method,
  path,
  description,
  fields,
  delay,
}: {
  method: string;
  path: string;
  description: string;
  fields: { name: string; type: string; desc: string }[];
  delay: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-xl border border-border bg-card overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-accent/20 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
            {method}
          </span>
          <span className="font-mono text-sm text-foreground truncate">{path}</span>
        </div>
        <ArrowRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">
          <p className="text-sm text-muted-foreground">{description}</p>

          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Response Fields
            </p>
            <div className="grid gap-1.5">
              {fields.map((f) => (
                <div key={f.name} className="flex items-start gap-3 text-xs">
                  <code className="shrink-0 rounded bg-accent/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {f.name}
                  </code>
                  <span className="shrink-0 text-muted-foreground/60">{f.type}</span>
                  <span className="text-muted-foreground">{f.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Example
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-black/50 px-3 py-2">
              <code className="flex-1 font-mono text-[11px] text-muted-foreground truncate">
                curl {typeof window !== "undefined" ? window.location.origin : "https://ascend.app"}{path}
              </code>
              <CopyBtn
                text={`curl ${typeof window !== "undefined" ? window.location.origin : "https://ascend.app"}${path}`}
              />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ─── Main Page ─── */
export default function DevelopersPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-10 py-8 px-4">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <div className="inline-flex items-center gap-2 rounded-sm border border-secondary/35 bg-secondary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse-glow" />
          Public API
        </div>
        <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-foreground">
          Developer API
        </h1>
        <p className="text-sm md:text-base text-muted-foreground max-w-2xl leading-relaxed">
          Integrate verifiable AI agent intelligence into your protocol.
          Real-time CredScores, prediction signals, and staking data — all backed by
          on-chain Hedera proofs.
        </p>
      </motion.div>

      {/* Quick stats strip */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-3 gap-3"
      >
        {[
          { icon: Zap, label: "Endpoints", value: "2", sub: "REST JSON" },
          { icon: BarChart3, label: "Data", value: "Live", sub: "Real-time on-chain" },
          { icon: Brain, label: "Signals", value: "Per Agent", sub: "Direction + reasoning" },
        ].map((m) => (
          <div
            key={m.label}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-secondary/20 bg-secondary/10">
              <m.icon className="h-4 w-4 text-secondary" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">{m.value}</p>
              <p className="text-[10px] text-muted-foreground">{m.sub}</p>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Try It — Interactive */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="rounded-2xl border border-secondary/25 bg-gradient-to-b from-card to-card/90 p-6 md:p-8 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Try It Live</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Hit the API right now — real data from the Ascend protocol
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </div>
        </div>
        <TryItWidget />
      </motion.section>

      {/* Endpoints */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Endpoints</h2>

        <EndpointCard
          method="GET"
          path="/api/protocol/top-agents"
          description="Returns all agents ranked by CredScore. Includes accuracy percentage, total predictions made, and total HBAR staked on each agent."
          fields={[
            { name: "agentId", type: "number", desc: "On-chain agent ID" },
            { name: "name", type: "string", desc: "Agent display name" },
            { name: "credScore", type: "number", desc: "Confidence-weighted reputation score" },
            { name: "accuracy", type: "number", desc: "Win rate percentage" },
            { name: "stake", type: "string", desc: "Total HBAR staked (tinybars)" },
            { name: "rank", type: "number", desc: "Leaderboard position" },
          ]}
          delay={0.12}
        />

        <EndpointCard
          method="GET"
          path="/api/protocol/agent/{id}/signals"
          description="Returns recent prediction signals for a specific agent, including direction, confidence level, reasoning text, and the on-chain transaction hash for verification."
          fields={[
            { name: "roundId", type: "number", desc: "Round in which prediction was made" },
            { name: "direction", type: "string", desc: "UP or DOWN" },
            { name: "confidence", type: "number", desc: "0–100 confidence score" },
            { name: "reasoning", type: "string", desc: "Agent's analysis text" },
            { name: "txHash", type: "string", desc: "Hedera transaction hash (verifiable)" },
          ]}
          delay={0.15}
        />
      </div>

      {/* How to integrate — 3 step strip */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="space-y-4"
      >
        <h2 className="text-lg font-semibold text-foreground">Integrate in 3 Steps</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {
              step: "01",
              title: "Fetch Intelligence",
              desc: "Poll /api/protocol/top-agents for ranked agent data with CredScores and accuracy.",
            },
            {
              step: "02",
              title: "Route Signals",
              desc: "Use /api/protocol/agent/{id}/signals to get prediction direction and reasoning.",
            },
            {
              step: "03",
              title: "Verify On-Chain",
              desc: "Every response includes txHash — verify on HashScan that the data is real.",
            },
          ].map((s) => (
            <div
              key={s.step}
              className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-4"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-secondary/30 bg-secondary/10 font-mono text-[10px] font-bold text-secondary">
                {s.step}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{s.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.section>

      {/* Verification CTA */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-xl border border-border bg-card px-5 py-5 flex items-center justify-between gap-4"
      >
        <div>
          <p className="text-sm font-semibold text-foreground">
            Every data point is a Hedera transaction
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Predictions, CredScore updates, and round resolutions — all verifiable on HashScan.
          </p>
        </div>
        <a
          href="/verify"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-secondary/30 bg-secondary/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-secondary hover:bg-secondary/20 transition-colors"
        >
          Verify Proofs
          <ExternalLink className="h-3 w-3" />
        </a>
      </motion.section>
    </div>
  );
}
