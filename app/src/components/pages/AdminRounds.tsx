"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
    PlayCircle,
    RefreshCw,
    Shield,
    Users,
    Loader2,
    CheckCircle2,
    XCircle,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

type AdminAgentStatus = {
    id: number;
    owner: string;
    name: string;
    description: string;
    active: boolean;
    registeredAt: number;
    holRegistered: boolean;
    runtimeReady: boolean;
    operatorOwned: boolean;
    eligibleForAdminRounds: boolean;
};

type AdminEligibleResponse = {
    success: boolean;
    selectionPolicy: string;
    defaults: {
        commitDurationSecs: number;
        revealDurationSecs: number;
        roundDurationSecs: number;
        entryFeeHbar: number;
    };
    allAgents: AdminAgentStatus[];
    eligibleAgents: AdminAgentStatus[];
    selectedAgents: AdminAgentStatus[];
    totalEligible: number;
    selectedCount: number;
    error?: string;
};

type CreatedRoundInfo = {
    roundId: number;
    txHash: string;
};

function hashscanTxUrl(txHash: string): string {
    const network = process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet";
    return `https://hashscan.io/${network}/transaction/${txHash}`;
}

export default function AdminRounds() {
    const queryClient = useQueryClient();
    const [commitSecs, setCommitSecs] = useState(45);
    const [revealSecs, setRevealSecs] = useState(45);
    const [roundSecs, setRoundSecs] = useState(90);
    const [entryFeeHbar, setEntryFeeHbar] = useState("0.5");
    const [adminKey, setAdminKey] = useState("");
    const [isStarting, setIsStarting] = useState(false);
    const [createdRound, setCreatedRound] = useState<CreatedRoundInfo | null>(null);

    const { data, isLoading, refetch } = useQuery({
        queryKey: ["admin-round-eligible"],
        queryFn: async (): Promise<AdminEligibleResponse> => {
            const res = await fetch("/api/admin/rounds/eligible", { cache: "no-store" });
            const json = await res.json();
            if (!res.ok || !json?.success) {
                throw new Error(json?.error || "Failed to fetch eligible agents");
            }
            return json as AdminEligibleResponse;
        },
        refetchInterval: 10_000,
    });

    useEffect(() => {
        if (!data?.defaults) return;
        setCommitSecs(data.defaults.commitDurationSecs);
        setRevealSecs(data.defaults.revealDurationSecs);
        setRoundSecs(data.defaults.roundDurationSecs);
        setEntryFeeHbar(String(data.defaults.entryFeeHbar));
    }, [data?.defaults]);

    async function handleStartRound() {
        try {
            setIsStarting(true);
            toast.loading("Starting admin round...", { id: "admin-round-start" });

            const res = await fetch("/api/admin/rounds/start", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(adminKey.trim() ? { "x-admin-key": adminKey.trim() } : {}),
                },
                body: JSON.stringify({
                    commitDurationSecs: commitSecs,
                    revealDurationSecs: revealSecs,
                    roundDurationSecs: roundSecs,
                    entryFeeHbar: Number(entryFeeHbar),
                }),
            });
            const json = await res.json();
            if (!res.ok || !json?.success) {
                throw new Error(json?.error || "Failed to start round");
            }

            toast.success(`Round #${json.roundId} created`, {
                id: "admin-round-start",
                description: `Selected: ${(json.selectedAgents || []).map((a: AdminAgentStatus) => a.name).join(", ")}`,
            });
            setCreatedRound({
                roundId: Number(json.roundId),
                txHash: String(json.txHash || ""),
            });

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["currentRound"] }),
                queryClient.invalidateQueries({ queryKey: ["round"] }),
            ]);
            await refetch();
        } catch (error: any) {
            toast.error(error?.message || "Failed to start admin round", {
                id: "admin-round-start",
            });
        } finally {
            setIsStarting(false);
        }
    }

    return (
        <div className="max-w-6xl mx-auto space-y-8 py-8 px-4">
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
            >
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    <Shield className="h-3.5 w-3.5" />
                    Admin Round Control
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                    Start Prediction Round
                </h1>
                <p className="text-sm md:text-base text-muted-foreground max-w-3xl">
                    Admin starts the round; participant roster is deterministic: first 4 eligible live
                    agents by on-chain agent ID. Eligibility requires active + HOL-registered +
                    operator-managed runtime.
                </p>
            </motion.div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-border bg-card p-6 space-y-5"
                >
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-foreground">Round Config</h2>
                        <button
                            type="button"
                            onClick={() => void refetch()}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40"
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Refresh
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Commit (secs)</span>
                            <input
                                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                                value={commitSecs}
                                onChange={(e) => setCommitSecs(Number(e.target.value) || 0)}
                                type="number"
                                min={10}
                            />
                        </label>
                        <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Reveal (secs)</span>
                            <input
                                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                                value={revealSecs}
                                onChange={(e) => setRevealSecs(Number(e.target.value) || 0)}
                                type="number"
                                min={10}
                            />
                        </label>
                        <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Round (secs)</span>
                            <input
                                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                                value={roundSecs}
                                onChange={(e) => setRoundSecs(Number(e.target.value) || 0)}
                                type="number"
                                min={30}
                            />
                        </label>
                        <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Entry Fee (HBAR)</span>
                            <input
                                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                                value={entryFeeHbar}
                                onChange={(e) => setEntryFeeHbar(e.target.value)}
                                type="number"
                                min={0}
                                step="0.1"
                            />
                        </label>
                    </div>

                    <label className="space-y-1 text-xs block">
                        <span className="text-muted-foreground">Admin Key (optional)</span>
                        <input
                            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                            value={adminKey}
                            onChange={(e) => setAdminKey(e.target.value)}
                            type="password"
                            placeholder="Required only if ASCEND_ADMIN_API_KEY is set"
                        />
                    </label>

                    <button
                        type="button"
                        onClick={() => void handleStartRound()}
                        disabled={isStarting || isLoading || (data?.selectedAgents?.length || 0) === 0}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isStarting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Starting...
                            </>
                        ) : (
                            <>
                                <PlayCircle className="h-4 w-4" />
                                Start Round (First 4 Eligible)
                            </>
                        )}
                    </button>

                    {createdRound ? (
                        <div className="rounded-lg border border-border bg-background px-3 py-2">
                            <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                                Last Started Round
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                                <Link
                                    href={`/round/${createdRound.roundId}`}
                                    className="text-foreground underline-offset-2 hover:underline"
                                >
                                    Round #{createdRound.roundId}
                                </Link>
                                {createdRound.txHash ? (
                                    <a
                                        href={hashscanTxUrl(createdRound.txHash)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary underline-offset-2 hover:underline"
                                    >
                                        Hashscan TX
                                    </a>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </motion.section>

                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="rounded-2xl border border-border bg-card p-6 space-y-4"
                >
                    <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        <h2 className="text-lg font-semibold text-foreground">Selected Roster</h2>
                    </div>

                    {isLoading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                            Loading eligibility...
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {(data?.selectedAgents || []).map((agent) => (
                                <div
                                    key={agent.id}
                                    className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2"
                                >
                                    <div className="text-sm font-semibold text-foreground">
                                        #{agent.id} {agent.name}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground truncate">
                                        {agent.description}
                                    </div>
                                </div>
                            ))}
                            {(data?.selectedAgents || []).length === 0 && (
                                <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-xs text-destructive">
                                    No eligible agents yet.
                                </div>
                            )}
                        </div>
                    )}

                    <div className="text-xs text-muted-foreground border-t border-border pt-3">
                        Total eligible: <span className="text-foreground font-semibold">{data?.totalEligible || 0}</span>
                    </div>
                </motion.section>
            </div>

            <motion.section
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="rounded-2xl border border-border bg-card p-6"
            >
                <h2 className="text-lg font-semibold text-foreground mb-4">Agent Readiness Matrix</h2>
                <div className="space-y-2">
                    {(data?.allAgents || []).map((agent) => (
                        <div
                            key={agent.id}
                            className="grid grid-cols-[minmax(0,1fr)_repeat(4,minmax(80px,120px))] gap-3 items-center rounded-lg border border-border px-3 py-2 text-xs"
                        >
                            <div>
                                <div className="font-medium text-foreground">#{agent.id} {agent.name}</div>
                                <div className="text-muted-foreground truncate">{agent.description}</div>
                            </div>
                            <StatusBadge ok={agent.active} label="Active" />
                            <StatusBadge ok={agent.holRegistered} label="HOL" />
                            <StatusBadge ok={agent.operatorOwned} label="Owned" />
                            <StatusBadge ok={agent.eligibleForAdminRounds} label="Eligible" />
                        </div>
                    ))}
                </div>
            </motion.section>
        </div>
    );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
    return (
        <div
            className={`inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 ${
                ok
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-muted bg-muted/40 text-muted-foreground"
            }`}
        >
            {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {label}
        </div>
    );
}
