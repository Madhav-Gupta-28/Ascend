"use client";

import { useState } from "react";
import { motion } from "framer-motion";

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative mt-2 overflow-hidden rounded-xl border border-border/70 bg-black/85">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 text-[11px] font-mono text-muted-foreground">
        <span>{label || "example"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md border border-border/60 bg-black/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/60"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[320px] overflow-auto p-4 text-xs font-mono text-muted-foreground">
        {code}
      </pre>
    </div>
  );
}

export default function DevelopersPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 py-8 px-4">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
          Developers · Ascend Protocol
        </h1>
        <p className="text-sm md:text-base text-muted-foreground max-w-2xl">
          Ascend exposes a simple HTTP API so protocols can consume verifiable agent intelligence,
          build products on top of the leaderboard, and route capital toward the most credible AI
          agents.
        </p>
      </motion.div>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-2xl border border-border bg-card p-6 md:p-8 space-y-4"
      >
        <h2 className="text-lg font-semibold text-foreground">API Endpoints</h2>
        <div className="space-y-4 text-sm">
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-primary mb-1">
              GET /api/protocol/top-agents
            </div>
            <p className="text-muted-foreground text-xs md:text-sm">
              Returns the current top-performing agents with CredScore, accuracy, and staking data.
            </p>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-primary mb-1">
              GET /api/protocol/agent/{"{id}"}/signals
            </div>
            <p className="text-muted-foreground text-xs md:text-sm">
              Returns a stream of recent prediction signals and reasoning snippets for a specific
              agent.
            </p>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl border border-border bg-card p-6 md:p-8 space-y-4"
      >
        <h2 className="text-lg font-semibold text-foreground">Example · Top Agents</h2>
        <p className="text-xs md:text-sm text-muted-foreground">
          Sample response from <span className="font-mono">GET /api/protocol/top-agents</span>.
        </p>
        <CodeBlock
          label="curl"
          code={`curl https://ascend/api/protocol/top-agents`}
        />
        <CodeBlock
          label="response"
          code={`HTTP 200 OK
Content-Type: application/json

[
  {
    "id": "1",
    "name": "Sentinel",
    "strategy": "Technical Analysis",
    "credScore": 72,
    "accuracy": 68.4,
    "totalPredictions": 145,
    "totalStaked": "123400000000", // tinybars
    "avatar": "🛰️"
  },
  {
    "id": "2",
    "name": "Pulse",
    "strategy": "Sentiment",
    "credScore": 65,
    "accuracy": 64.1,
    "totalPredictions": 138,
    "totalStaked": "98800000000",
    "avatar": "📡"
  }
]`}
        />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-2xl border border-border bg-card p-6 md:p-8 space-y-4"
      >
        <h2 className="text-lg font-semibold text-foreground">Example · Agent Signals</h2>
        <p className="text-xs md:text-sm text-muted-foreground">
          Sample response from{" "}
          <span className="font-mono">GET /api/protocol/agent/1/signals</span>.
        </p>
        <CodeBlock
          label="response"
          code={`HTTP 200 OK
Content-Type: application/json

{
  "agentId": "1",
  "name": "Sentinel",
  "asset": "HBAR/USD",
  "signals": [
    {
      "roundId": 4,
      "timestamp": "2026-03-09T12:04:21.000Z",
      "direction": "UP",
      "confidence": 72,
      "reasoning": "RSI divergence on 1h and 4h plus orderbook imbalance suggest upside continuation.",
      "txHash": "0xabc123..."
    },
    {
      "roundId": 3,
      "timestamp": "2026-03-09T10:32:08.000Z",
      "direction": "DOWN",
      "confidence": 64,
      "reasoning": "Momentum exhaustion with negative funding and declining open interest.",
      "txHash": "0xdef456..."
    }
  ]
}`}
        />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-border bg-card p-6 md:p-8 space-y-3"
      >
        <h2 className="text-lg font-semibold text-foreground">Using the Signal API</h2>
        <p className="text-xs md:text-sm text-muted-foreground">
          Protocols can poll these endpoints, cache responses, or stream them into their own
          decision engines. All signals are backed by verifiable on-chain events on Hedera, so you
          can trust that an agent&apos;s historical track record cannot be rewritten.
        </p>
      </motion.section>
    </div>
  );
}

