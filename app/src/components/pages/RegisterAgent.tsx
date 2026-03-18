"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CheckCircle2, CircleHelp, ExternalLink, Loader2, X } from "lucide-react";
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI } from "@/lib/contracts";
import { useHederaWallet } from "@/hooks/use-hedera-wallet";
import { toast } from "sonner";
import { formatHbar, parseHbar, getProvider } from "@/lib/hedera";
import { ethers } from "ethers";
import { useQueryClient } from "@tanstack/react-query";
import { hashscanTransactionUrl } from "@/lib/explorer";

const PREDEFINED_STRATEGIES = [
  {
    id: "technical",
    name: "Technical Analysis",
    description:
      "Analyzes on-chain momentum, RSI divergence, and moving average crossovers to predict short-term volatility.",
  },
  {
    id: "sentiment",
    name: "Social Sentiment",
    description:
      "Ingests Twitter volumes, Telegram keywords, and news sentiment APIs to map retail emotional exhaustion.",
  },
  {
    id: "mean-reversion",
    name: "Mean Reversion",
    description:
      "Identifies statistically significant deviations from VWAP to fade extreme market moves.",
  },
  {
    id: "meta-ai",
    name: "Meta-AI Tracker",
    description:
      "Observes prediction patterns of top agents and executes a weighted consensus model.",
  },
];

function isExpectedWalletError(message: string): boolean {
  return /proposal expired|request expired|rejected in wallet|user rejected|cancelled by user/i.test(message);
}

function hashscanTxUrl(txIdOrHash: string): string {
  return hashscanTransactionUrl(txIdOrHash);
}

function extractTransactionId(result: unknown): string | null {
  const queue: unknown[] = [result];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    const record = current as Record<string, unknown>;
    const directCandidates = [
      record.transactionId,
      record.transaction_id,
      record.txId,
      record.tx_id,
      record.hash,
      record.transactionHash,
      record.transaction_hash,
    ];

    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return null;
}

type DeploymentProof = {
  contractTxId: string | null;
  contractTxUrl: string | null;
  agentId: number | null;
  agentPageUrl: string | null;
};

export default function RegisterAgent() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deployStep, setDeployStep] = useState<"idle" | "evm" | "done">("idle");
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [bondTinybars, setBondTinybars] = useState<bigint>(parseHbar("1"));
  const [deploymentProof, setDeploymentProof] = useState<DeploymentProof | null>(null);

  const { isConnected, executeContractFunction } = useHederaWallet();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!selectedStrategy) return;
    const strategy = PREDEFINED_STRATEGIES.find((item) => item.id === selectedStrategy);
    if (strategy) setDescription(strategy.description);
  }, [selectedStrategy]);

  useEffect(() => {
    let mounted = true;
    async function loadMinimumBond() {
      try {
        const provider = getProvider();
        const registry = new ethers.Contract(
          CONTRACT_ADDRESSES.agentRegistry,
          AGENT_REGISTRY_ABI,
          provider,
        );
        const minBond = await registry.MIN_BOND();
        if (mounted && typeof minBond === "bigint" && minBond > 0n) {
          setBondTinybars(minBond);
        }
      } catch {
        // Keep default fallback of 1 HBAR if read fails.
      }
    }
    void loadMinimumBond();
    return () => {
      mounted = false;
    };
  }, []);

  const bondHbarDisplay = Number(formatHbar(bondTinybars)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected) {
      toast.error("Connect wallet first to register an agent.");
      return;
    }

    if (!name || !description) {
      toast.error("Name and description are required.");
      return;
    }

    try {
      setDeploymentProof(null);
      setIsSubmitting(true);
      setDeployStep("evm");

      const bondAmountInTinybars = bondTinybars.toString();
      const args = [name, description];

      const registerResult = await executeContractFunction(
        CONTRACT_ADDRESSES.agentRegistry,
        AGENT_REGISTRY_ABI,
        "registerAgent",
        args,
        bondAmountInTinybars,
      );
      const contractTxId = extractTransactionId(registerResult);
      const contractTxUrl = contractTxId ? hashscanTxUrl(contractTxId) : null;
      let onChainAgentId: number | null = null;
      try {
        const provider = getProvider();
        const registry = new ethers.Contract(
          CONTRACT_ADDRESSES.agentRegistry,
          AGENT_REGISTRY_ABI,
          provider,
        );
        onChainAgentId = Number(await registry.getAgentCount());
      } catch {
        onChainAgentId = null;
      }
      setDeploymentProof({
        contractTxId,
        contractTxUrl,
        agentId: onChainAgentId,
        agentPageUrl: onChainAgentId ? `/agent/${onChainAgentId}` : null,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agents"] }),
        queryClient.invalidateQueries({ queryKey: ["currentRound"] }),
      ]);
      toast.success(`Agent ${name} registered on-chain.`, { id: "register-tx" });

      setDeployStep("done");
      setTimeout(() => {
        setIsSubmitting(false);
        setDeployStep("idle");
        setName("");
        setDescription("");
        setSelectedStrategy("");
      }, 2200);
    } catch (err: any) {
      const message = err?.message || "Unknown error";
      if (!isExpectedWalletError(message)) {
        console.warn("Registration failed:", err);
      }
      toast.error(`Transaction failed: ${message}`, { id: "register-tx" });
      setIsSubmitting(false);
      setDeployStep("idle");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-9 pb-16 md:space-y-12 md:pb-20">
      <motion.section
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="terminal-surface px-5 py-7 md:px-7 md:py-9"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-kicker">Developer Console</p>
            <h1 className="font-display text-4xl uppercase tracking-[-0.03em] text-foreground md:text-6xl">
              Launch Intelligence Agent
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Register once on-chain and enter live prediction rounds immediately.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            className="inline-flex h-10 items-center gap-1 rounded-sm border border-border bg-card px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground transition-colors hover:border-secondary/50 hover:text-secondary"
          >
            <CircleHelp className="h-3.5 w-3.5" />
            Help
          </button>
        </div>
      </motion.section>

      <div className="grid items-start gap-7 lg:grid-cols-[1.15fr_1fr]">
        <section className="terminal-surface px-5 py-6 md:px-6 md:py-7">
          <form onSubmit={handleRegister} className="space-y-6">
            <div className="space-y-2">
              <label className="terminal-heading">Agent Name</label>
              <input
                type="text"
                placeholder="e.g. QuantBot Alpha"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
                required
                className="h-11 w-full rounded-sm border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-secondary"
              />
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Must be unique on-chain
              </p>
            </div>

            <div className="space-y-2">
              <label className="terminal-heading">Strategy Template</label>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                className="h-11 w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-secondary"
              >
                <option value="">Select a template (optional)</option>
                {PREDEFINED_STRATEGIES.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="terminal-heading">Description</label>
              <textarea
                placeholder="Describe your model's signals and market methodology."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={256}
                required
                className="min-h-[130px] w-full rounded-sm border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-secondary"
              />
            </div>

            <div className="rounded-sm border border-border bg-card px-4 py-3.5">
              <p className="terminal-heading">Registration Bond</p>
              <p className="mt-2 font-mono text-xl text-foreground">{bondHbarDisplay} HBAR</p>
              <p className="mt-1 text-xs text-muted-foreground">Refundable on deregistration.</p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !isConnected}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-sm border border-border bg-foreground px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {!isConnected ? (
                "Connect Wallet"
              ) : isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Deploying
                </>
              ) : (
                <>
                  Deploy Agent
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>

            {deploymentProof ? (
              <div className="rounded-sm border border-border bg-card px-4 py-3.5">
                <p className="terminal-heading">Deployment Proof</p>
                <div className="mt-2 space-y-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      Contract TX
                    </p>
                    {deploymentProof.contractTxUrl ? (
                      <a
                        href={deploymentProof.contractTxUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-secondary hover:text-secondary/85"
                      >
                        {deploymentProof.contractTxId}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">Pending wallet tx id</p>
                    )}
                  </div>

                  {deploymentProof.agentId ? (
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        On-chain Agent ID
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-foreground">#{deploymentProof.agentId}</span>
                        {deploymentProof.agentPageUrl ? (
                          <Link
                            href={deploymentProof.agentPageUrl}
                            className="inline-flex items-center gap-1 font-mono text-[11px] text-secondary hover:text-secondary/85"
                          >
                            Open agent page
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </form>
        </section>

        <section className="terminal-surface px-5 py-6 md:px-6 md:py-7">
          <p className="section-kicker">Preview</p>
          <div className="mt-3 flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-border bg-card text-2xl">
              🤖
            </div>
            <div>
              <p className="font-display text-xl uppercase tracking-[-0.02em] text-foreground">
                {name || "Agent Name"}
              </p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {selectedStrategy
                  ? PREDEFINED_STRATEGIES.find((item) => item.id === selectedStrategy)?.name
                  : "Custom Strategy"}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="rounded-sm border border-border bg-card px-3 py-2.5">
              <p className="terminal-heading">Model Summary</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {description || "No description yet. Add a strategy to show how this agent will reason on market data."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-sm border border-border bg-card px-3 py-2.5">
                <p className="terminal-heading">Start CredScore</p>
                <p className="mt-2 font-mono text-lg text-foreground">0</p>
              </div>
              <div className="rounded-sm border border-border bg-card px-3 py-2.5">
                <p className="terminal-heading">Total Staked</p>
                <p className="mt-2 font-mono text-lg text-foreground">0 HBAR</p>
              </div>
            </div>

            <div className="rounded-sm border border-border bg-card px-3 py-2.5">
              <p className="terminal-heading">Post-Registration Routing</p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Agent is immediately visible in on-chain registry and eligible for rounds
              </p>
            </div>
          </div>
        </section>
      </div>

      <AnimatePresence>
        {isHelpOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4"
            onClick={() => setIsHelpOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="terminal-surface w-full max-w-xl px-5 py-5 md:px-6 md:py-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-kicker">Help</p>
                  <h2 className="section-title mt-1">What Registering An Agent Means</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsHelpOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground hover:text-foreground"
                  aria-label="Close help dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                <p>
                  Registration creates your agent in the on-chain `AgentRegistry` with a refundable bond.
                </p>
                <p>
                  After on-chain success, your agent appears in the directory, can be selected for rounds, and accumulates CredScore from verifiable outcomes.
                </p>
                <p>
                  Once active, your agent can be selected into prediction rounds, build CredScore, and attract user staking.
                </p>
              </div>

              <div className="mt-5 rounded-sm border border-border bg-card px-3 py-2.5">
                <p className="terminal-heading">You Can Do Next</p>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Open Agents page • verify on-chain status • monitor rounds • receive stake backing
                </p>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isSubmitting ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="terminal-surface w-full max-w-md px-5 py-5"
            >
              <p className="section-kicker">Deployment Pipeline</p>
              <div className="mt-4 space-y-3 font-mono text-[11px] uppercase tracking-[0.12em]">
                <div className="flex items-center gap-2">
                  {deployStep === "evm" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-secondary" />
                  )}
                  <span className="text-foreground">On-chain registration</span>
                </div>

                <div className="flex items-center gap-2">
                  {deployStep === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-secondary" />
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full border border-border" />
                  )}
                  <span className={deployStep === "idle" ? "text-muted-foreground" : "text-foreground"}>
                    Agent indexed
                  </span>
                </div>

                {deployStep === "done" ? (
                  <p className="pt-2 text-secondary">Agent deployed successfully.</p>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
