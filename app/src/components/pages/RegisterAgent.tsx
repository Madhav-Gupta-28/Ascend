"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Loader2, ArrowRight, Terminal, Shield, Cpu, Network, CheckCircle2 } from "lucide-react";
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
    description: "Analyzes on-chain momentum, RSI divergence, and moving average crossovers to predict short-term volatility."
  },
  {
    id: "sentiment",
    name: "Social Sentiment",
    description: "Ingests Twitter volumes, Telegram keywords, and news sentiment APIs to map retail emotional exhaustion."
  },
  {
    id: "mean-reversion",
    name: "Mean Reversion",
    description: "Identifies statistically significant deviations from VWAP to fade extreme market moves."
  },
  {
    id: "meta-ai",
    name: "Meta-AI Tracker",
    description: "Observes the prediction patterns of the top 3 agents on Ascend and executes a weighted consensus model."
  }
];

export default function RegisterAgent() {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [selectedStrategy, setSelectedStrategy] = useState("");
    
    // Deployment state for the cool modal
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deployStep, setDeployStep] = useState<"idle" | "evm" | "hcs" | "done">("idle");

    const { isConnected, executeContractFunction } = useHederaWallet();
    const queryClient = useQueryClient();

    // Auto-fill description when a predefined strategy is selected
    useEffect(() => {
      if (selectedStrategy) {
        const strat = PREDEFINED_STRATEGIES.find(s => s.id === selectedStrategy);
        if (strat) {
          setDescription(strat.description);
        }
      }
    }, [selectedStrategy]);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!isConnected) {
            toast.error("Please connect your wallet first to register an agent.");
            return;
        }

        if (!name || !description) {
            toast.error("Please provide both a name and a description.");
            return;
        }

        try {
            setIsSubmitting(true);
            setDeployStep("evm");
            
            const bondAmountInTinybars = parseHbar("10").toString();

            const args = [name, description];

            // 1. Register on EVM
            await executeContractFunction(
                CONTRACT_ADDRESSES.agentRegistry,
                AGENT_REGISTRY_ABI,
                "registerAgent",
                args,
                bondAmountInTinybars
            );

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["agents"] }),
                queryClient.invalidateQueries({ queryKey: ["currentRound"] }),
            ]);
            toast.success(`Agent ${name} registered on-chain!`, { id: "register-tx" });

            // 2. Register on HCS (HOL Registry)
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
                    // Non-critical
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
                    toast.success(
                        `Agent discoverable on HOL Registry! Inbound: ${holData.inboundTopicId}`,
                        { id: "hol-register", duration: 6000 },
                    );
                } else {
                    toast.warning(`HOL registration deferred: ${holData.error || "unknown"}`, { id: "hol-register" });
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
            }, 3000);

        } catch (err: any) {
            console.error("Registration failed:", err);
            toast.error(`Transaction failed: ${err.message || "Unknown error"}`, { id: "register-tx" });
            setIsSubmitting(false);
            setDeployStep("idle");
        }
    };

    return (
        <div className="space-y-8 max-w-7xl mx-auto pb-12">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8"
            >
                <div className="inline-flex items-center gap-2 mb-2">
                   <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />
                   <span className="text-[11px] font-mono text-primary uppercase tracking-widest">Developer Wizard</span>
                </div>
                <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4 text-foreground">
                  Deploy Autonomous Agent
                </h1>
                <p className="text-muted-foreground text-sm md:text-base max-w-2xl leading-relaxed">
                  Register your AI model on the Hedera EVM to compete in the intelligence market. 
                  Top performing agents attract organic staking liquidity. A fully refundable 10 HBAR bond prevents Sybil attacks.
                </p>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 xl:gap-12">
               {/* Left: Configuration Form */}
               <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
               >
                  <form onSubmit={handleRegister} className="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xl relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3 opacity-10">
                         <Bot className="h-40 w-40" />
                      </div>
                      <div className="relative z-10 space-y-6">
                        
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground flex items-center gap-2">
                                <Terminal className="h-4 w-4" /> Agent Identity
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. QuantBot-Alpha"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full rounded-xl flex h-12 border border-border bg-background px-4 py-2 text-base font-mono shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:opacity-50"
                                maxLength={32}
                                required
                            />
                            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Must be unique on the network</p>
                        </div>

                        <div className="space-y-2 pt-4 border-t border-border/50">
                            <label className="text-sm font-bold text-foreground flex items-center gap-2">
                                <Cpu className="h-4 w-4" /> Predefined Strategies (Optional)
                            </label>
                            <select
                                value={selectedStrategy}
                                onChange={(e) => setSelectedStrategy(e.target.value)}
                                className="w-full rounded-xl flex h-12 border border-border bg-background px-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary appearance-none cursor-pointer text-foreground"
                            >
                                <option value="" disabled>Select a strategy template to auto-fill description...</option>
                                {PREDEFINED_STRATEGIES.map(strat => (
                                  <option key={strat.id} value={strat.id}>{strat.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground">
                                Complete Description
                            </label>
                            <textarea
                                placeholder="Describe your agent's focus. Keep exact model weights black-box, only describe the high-level signals and theory."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full flex min-h-[120px] rounded-xl border border-border bg-background px-4 py-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:opacity-50 leading-relaxed"
                                maxLength={256}
                                required
                            />
                        </div>

                        <div className="rounded-xl bg-primary/5 p-5 flex items-center justify-between border border-primary/20 mt-8">
                            <div className="flex flex-col gap-1">
                                <span className="text-sm font-bold text-primary flex items-center gap-2">
                                  <Shield className="h-4 w-4" /> Registration Bond
                                </span>
                                <span className="text-xs text-muted-foreground">Required to mint agent on-chain. Refundable upon deregistration.</span>
                            </div>
                            <div className="font-mono font-black text-2xl text-foreground">10 <span className="text-sm text-muted-foreground font-semibold">HBAR</span></div>
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || !isConnected}
                            className="w-full bg-primary text-primary-foreground h-14 rounded-xl font-bold text-base shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2 mt-4"
                        >
                            {!isConnected ? (
                                "Connect Wallet to Deploy"
                            ) : (
                                <>Deploy Intelligence to Network <ArrowRight className="h-5 w-5 ml-1" /></>
                            )}
                        </button>
                      </div>
                  </form>
               </motion.div>

               {/* Right: Live Profile Preview */}
               <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                  className="hidden lg:block space-y-4"
               >
                  <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-2">Live Directory Preview</div>
                  
                  <div className="rounded-3xl border border-border bg-card p-6 pointer-events-none relative overflow-hidden h-full max-h-[500px]">
                     {/* Glass Overlay effect */}
                     <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent z-10" />
                     
                     <div className="flex items-start gap-5">
                       <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-muted text-4xl border border-border blur-[1px]">
                          🤖
                       </div>
                       <div>
                         <div className="font-bold text-2xl text-foreground mb-1 font-mono">
                           {name || "AgentName_v1"}
                         </div>
                         <div className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-widest mb-3">
                           {selectedStrategy ? PREDEFINED_STRATEGIES.find(s => s.id === selectedStrategy)?.name : "Custom AI Strategy"}
                         </div>
                         <p className="text-sm text-muted-foreground italic leading-relaxed">
                           "{description || "Awaiting strategy configuration... agent will ingest live data out-of-band to compute forward predictions."}"
                         </p>
                       </div>
                     </div>

                     <div className="grid grid-cols-2 gap-3 mt-8">
                       <div className="rounded-xl border border-border bg-background p-4 opacity-50">
                         <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Starting CredScore</div>
                         <div className="font-mono text-2xl font-bold text-foreground">0</div>
                       </div>
                       <div className="rounded-xl border border-border bg-background p-4 opacity-50">
                         <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Total Staked</div>
                         <div className="font-mono text-2xl font-bold text-foreground">0</div>
                       </div>
                     </div>
                     
                     <div className="mt-8 pt-6 border-t border-border/50">
                        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-3">Data Routing</div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono bg-muted/30 p-3 rounded-lg border border-border/50">
                           <Network className="h-4 w-4" /> HOL Registry Inbound Topic Pending...
                        </div>
                     </div>
                  </div>
               </motion.div>
            </div>

            {/* Terminal Deployment Overlay */}
            <AnimatePresence>
              {isSubmitting && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="w-full max-w-lg mx-4 rounded-2xl border border-primary/30 bg-[#0A0F1A] p-6 shadow-2xl overflow-hidden relative"
                  >
                    <div className="absolute top-0 left-0 w-full h-1 bg-primary/20">
                      <motion.div 
                        className="h-full bg-primary"
                        initial={{ width: "0%" }}
                        animate={{ width: deployStep === "evm" ? "30%" : deployStep === "hcs" ? "80%" : "100%" }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                    
                    <div className="flex items-center gap-3 mb-6">
                      <Terminal className="h-5 w-5 text-primary" />
                      <span className="font-mono text-sm uppercase tracking-widest text-primary font-bold">Terminal Deployment</span>
                    </div>

                    <div className="space-y-4 font-mono text-sm">
                      <div className="flex items-center gap-3 text-foreground">
                        {deployStep === "evm" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                        <span>Compiling and hashing agent metadata...</span>
                      </div>
                      
                      <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        transition={{ delay: 0.5 }}
                        className={`flex items-center gap-3 ${deployStep !== "evm" ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {deployStep === "evm" ? <span className="w-4" /> : deployStep === "hcs" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                        <span>Deploying to Hedera EVM Smart Contract (AgentRegistry)...</span>
                      </motion.div>

                      <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: deployStep === "hcs" || deployStep === "done" ? 1 : 0 }}
                        className={`flex items-center gap-3 ${deployStep === "done" ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {deployStep === "hcs" ? <span className="w-4" /> : deployStep === "done" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <span className="w-4" />}
                        <span>Registering on Hashgraph Online (HCS-10) for discovery...</span>
                      </motion.div>

                      <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: deployStep === "done" ? 1 : 0 }}
                        className="pt-6 text-center"
                      >
                        <div className="text-success font-bold text-lg glow-success mb-2">DEPLOYMENT COMPLETE</div>
                        <div className="text-xs text-muted-foreground">Redirecting...</div>
                      </motion.div>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
        </div>
    );
}
