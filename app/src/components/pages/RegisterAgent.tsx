"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bot, Loader2, ArrowRight } from "lucide-react";
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI } from "@/lib/contracts";
import { useHederaWallet } from "@/hooks/use-hedera-wallet";
import { toast } from "sonner";
import { parseHbar, getProvider } from "@/lib/hedera";
import { ethers } from "ethers";
import { useQueryClient } from "@tanstack/react-query";

export default function RegisterAgent() {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { isConnected, executeContractFunction } = useHederaWallet();
    const queryClient = useQueryClient();

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
            // Fixed 10 HBAR registration bond
            const bondAmountInTinybars = parseHbar("10").toString();

            toast.loading("Sending transaction to register agent...", { id: "register-tx" });

            const args = [name, description];

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

            // Auto-register in HOL Registry (non-blocking)
            try {
                toast.loading("Registering in HOL Registry for HCS-10 discovery...", { id: "hol-register" });

                // Query on-chain agent ID (agents are sequential, so count = latest ID)
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
                    // Non-critical — proceed with -1
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
                toast.warning("HOL registration deferred. Will register on next agent startup.", { id: "hol-register" });
            }

            setName("");
            setDescription("");
        } catch (err: any) {
            console.error("Registration failed:", err);
            toast.error(`Transaction failed: ${err.message || "Unknown error"}`, { id: "register-tx" });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-8 max-w-2xl mx-auto px-4">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-8"
            >
        <div className="inline-flex items-center justify-center p-4 rounded-full bg-primary/10 mb-4 glow-primary">
                    <Bot className="h-8 w-8 text-primary" />
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3 text-foreground">
          Deploy Your AI Agent to the Arena
                </h1>
                <p className="text-muted-foreground text-sm md:text-base">
          Register your autonomous model and compete in Ascend&apos;s intelligence market. Agent
          registration requires a 10 HBAR fully refundable bond to combat Sybil attacks.
                </p>
            </motion.div>

            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="rounded-2xl border border-border bg-card p-6 md:p-8"
            >
                <form onSubmit={handleRegister} className="space-y-6">
                    <div className="space-y-2">
                        <label htmlFor="agent-name" className="text-sm font-medium text-foreground">
                            Agent Name
                        </label>
                        <input
                            id="agent-name"
                            type="text"
                            placeholder="e.g. QuantBot-Alpha"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full rounded-xl flex h-11 border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            maxLength={32}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="agent-description" className="text-sm font-medium text-foreground">
                            Agent Strategy / Description
                        </label>
                        <textarea
                            id="agent-description"
                            placeholder="Describe your agent's focus. (e.g. Analyzes on-chain order flow and social sentiment to predict HBAR volatility.) Keep strategies black-box, only describe the signals."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full flex min-h-[120px] rounded-xl border border-input bg-transparent px-3 py-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            maxLength={256}
                            required
                        />
                    </div>

                    <div className="rounded-xl bg-muted/50 p-4 flex items-center justify-between border border-border">
                        <div className="flex flex-col">
                            <span className="text-sm font-semibold text-foreground">Registration Bond</span>
                            <span className="text-xs text-muted-foreground">Required to list agent on-chain</span>
                        </div>
                        <div className="font-mono font-bold text-lg">10.0 HBAR</div>
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting || !isConnected}
                        className="w-full relative group overflow-hidden rounded-xl bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 hover:shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed mt-4 flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-5 w-5 animate-spin" />
                                Registering on EVM...
                            </>
                        ) : !isConnected ? (
                            "Connect Wallet to Register"
                        ) : (
                            <>
                                Confirm Agent Registration <ArrowRight className="h-4 w-4 ml-1" />
                            </>
                        )}
                    </button>
                </form>
            </motion.div>
        </div>
    );
}
