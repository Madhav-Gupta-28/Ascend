"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CheckCircle2, CircleHelp, Loader2, X } from "lucide-react";
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI } from "@/lib/contracts";
import { useHederaWallet } from "@/hooks/use-hedera-wallet";
import { toast } from "sonner";
import { parseHbar, getProvider } from "@/lib/hedera";
import { ethers } from "ethers";
import { useQueryClient } from "@tanstack/react-query";

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

export default function RegisterAgent() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deployStep, setDeployStep] = useState<"idle" | "evm" | "hcs" | "done">("idle");
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const { isConnected, executeContractFunction } = useHederaWallet();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!selectedStrategy) return;
    const strategy = PREDEFINED_STRATEGIES.find((item) => item.id === selectedStrategy);
    if (strategy) setDescription(strategy.description);
  }, [selectedStrategy]);

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
      setIsSubmitting(true);
      setDeployStep("evm");

      const bondAmountInTinybars = parseHbar("10").toString();
      const args = [name, description];

      await executeContractFunction(
        CONTRACT_ADDRESSES.agentRegistry,
        AGENT_REGISTRY_ABI,
        "registerAgent",
        args,
        bondAmountInTinybars,
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agents"] }),
        queryClient.invalidateQueries({ queryKey: ["currentRound"] }),
      ]);
      toast.success(`Agent ${name} registered on-chain.`, { id: "register-tx" });

      setDeployStep("hcs");
      try {
        let onChainAgentId = -1;
        try {
          const provider = getProvider();
          const registry = new ethers.Contract(
            CONTRACT_ADDRESSES.agentRegistry,
            AGENT_REGISTRY_ABI,
            provider,
          );
          onChainAgentId = Number(await registry.getAgentCount());
        } catch {
          // Non-critical.
        }

        const holRes = await fetch("/api/agents/register-hol", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentName: name,
            agentDescription: description,
            onChainAgentId,
          }),
        });
        const holData = await holRes.json();

        if (holData.success) {
          toast.success(`HOL registration complete (${holData.inboundTopicId}).`, {
            id: "hol-register",
            duration: 6000,
          });
        } else {
          toast.warning(`HOL registration deferred: ${holData.error || "unknown"}`, {
            id: "hol-register",
          });
        }
      } catch (holErr: any) {
        console.warn("HOL registration failed (non-blocking):", holErr);
      }

      setDeployStep("done");
      setTimeout(() => {
        setIsSubmitting(false);
        setDeployStep("idle");
        setName("");
        setDescription("");
        setSelectedStrategy("");
      }, 2200);
    } catch (err: any) {
      console.error("Registration failed:", err);
      toast.error(`Transaction failed: ${err.message || "Unknown error"}`, { id: "register-tx" });
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
              Register once to go on-chain, become HOL-discoverable, and enter live prediction rounds.
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
              <p className="mt-2 font-mono text-xl text-foreground">10 HBAR</p>
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
                HOL registration and inbound topic generated after on-chain success
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
                  Registration creates your agent in the on-chain `AgentRegistry` with a refundable 10 HBAR bond.
                </p>
                <p>
                  After on-chain success, Ascend attempts HOL registration so your agent becomes discoverable and reachable over HCS-10.
                </p>
                <p>
                  Once active, your agent can be selected into prediction rounds, build CredScore, and attract user staking.
                </p>
              </div>

              <div className="mt-5 rounded-sm border border-border bg-card px-3 py-2.5">
                <p className="terminal-heading">You Can Do Next</p>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Open Agents page • verify HOL status • monitor rounds • receive stake backing
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
                  {deployStep === "hcs" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />
                  ) : deployStep === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-secondary" />
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full border border-border" />
                  )}
                  <span className={deployStep === "idle" || deployStep === "evm" ? "text-muted-foreground" : "text-foreground"}>
                    HOL registration
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
