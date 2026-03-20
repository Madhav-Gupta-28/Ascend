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
    Wrench,
    ExternalLink,
    X,
    Zap,
    Server,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useResolvedTransactionLinks } from "@/hooks/useResolvedTransactionLinks";

type AdminAgentStatus = {
    id: number;
    owner: string;
    name: string;
    description: string;
    active: boolean;
    registeredAt: number;
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
    activeRoundIds: number[];
    staleActiveRoundIds: number[];
    latestRoundId: number;
    error?: string;
};

type CreatedRoundInfo = {
    roundId: number;
    txHash: string;
    txHashscanUrl: string;
    selectedAgents: AdminAgentStatus[];
    startPriceUsd: number | null;
    orchestratorWake: { status: string; error?: string } | null;
};

export default function AdminRounds() {
    const queryClient = useQueryClient();
    const [commitSecs, setCommitSecs] = useState(45);
    const [revealSecs, setRevealSecs] = useState(45);
    const [roundSecs, setRoundSecs] = useState(90);
    const [entryFeeHbar, setEntryFeeHbar] = useState("0.5");
    const [adminKey, setAdminKey] = useState("");
    const [isStarting, setIsStarting] = useState(false);
    const [isCleaning, setIsCleaning] = useState(false);
    const [createdRound, setCreatedRound] = useState<CreatedRoundInfo | null>(null);
    const { getTransactionUrl } = useResolvedTransactionLinks([createdRound?.txHash ?? null]);

    // Orchestrator pre-warm state
    const [orchStatus, setOrchStatus] = useState<"unknown" | "checking" | "awake" | "waking" | "offline">("unknown");
    const [orchUptime, setOrchUptime] = useState<number | null>(null);
    const [orchRoundsProcessed, setOrchRoundsProcessed] = useState<number>(0);

    async function checkOrchestrator() {
        setOrchStatus("checking");
        try {
            const res = await fetch("/api/orchestrator/status", { signal: AbortSignal.timeout(8_000) });
            if (!res.ok) throw new Error("not ok");
            const json = await res.json();
            // Check if orchestrator is truly reachable (not just "not_configured" or "unreachable")
            if (json.status === "not_configured" || json.status === "unreachable") {
                setOrchStatus("offline");
                return;
            }
            setOrchStatus("awake");
            setOrchUptime(typeof json.uptime === "number" ? json.uptime : null);
            setOrchRoundsProcessed(typeof json.roundsProcessed === "number" ? json.roundsProcessed : 0);
        } catch {
            setOrchStatus("offline");
        }
    }

    async function wakeOrchestrator() {
        setOrchStatus("waking");

        function isAlive(json: any): boolean {
            return json && json.status !== "not_configured" && json.status !== "unreachable";
        }

        try {
            // First try health check — might already be awake
            const healthRes = await fetch("/api/orchestrator/status", { signal: AbortSignal.timeout(5_000) });
            if (healthRes.ok) {
                const json = await healthRes.json();
                if (isAlive(json)) {
                    setOrchStatus("awake");
                    setOrchUptime(typeof json.uptime === "number" ? json.uptime : null);
                    setOrchRoundsProcessed(typeof json.roundsProcessed === "number" ? json.roundsProcessed : 0);
                    return;
                }
            }
        } catch { /* cold — proceed to wake */ }

        // Hit the status proxy repeatedly — each request hits Render, which triggers cold-start
        for (let i = 0; i < 8; i++) {
            await new Promise((r) => setTimeout(r, 5_000));
            try {
                const res = await fetch("/api/orchestrator/status", { signal: AbortSignal.timeout(10_000) });
                if (res.ok) {
                    const json = await res.json();
                    if (isAlive(json)) {
                        setOrchStatus("awake");
                        setOrchUptime(typeof json.uptime === "number" ? json.uptime : null);
                        setOrchRoundsProcessed(typeof json.roundsProcessed === "number" ? json.roundsProcessed : 0);
                        return;
                    }
                }
            } catch { /* still waking */ }
        }
        setOrchStatus("offline");
    }

    // Auto-check orchestrator on mount
    useEffect(() => { checkOrchestrator(); }, []);

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

            toast.success(`Round #${json.roundId} started`, { id: "admin-round-start" });
            setCreatedRound({
                roundId: Number(json.roundId),
                txHash: String(json.txHash || ""),
                txHashscanUrl: String(json.txHashscanUrl || ""),
                selectedAgents: json.selectedAgents || [],
                startPriceUsd: typeof json.startPriceUsd === "number" ? json.startPriceUsd : null,
                orchestratorWake: json.orchestratorWake ?? null,
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

    async function handleCleanupRounds() {
        try {
            setIsCleaning(true);
            toast.loading("Cleaning stale rounds...", { id: "admin-round-cleanup" });
            const res = await fetch("/api/admin/rounds/cleanup", {
                method: "POST",
                headers: {
                    ...(adminKey.trim() ? { "x-admin-key": adminKey.trim() } : {}),
                },
            });
            const json = await res.json();
            if (!res.ok || !json?.success) {
                throw new Error(json?.error || "Failed to cleanup stale rounds");
            }
            const cancelled = Array.isArray(json?.cancelledRoundIds) ? json.cancelledRoundIds : [];
            if (cancelled.length === 0) {
                toast.success("No stale rounds found", { id: "admin-round-cleanup" });
            } else {
                toast.success(`Cancelled stale round(s): ${cancelled.map((id: number) => `#${id}`).join(", ")}`, {
                    id: "admin-round-cleanup",
                });
            }
            await refetch();
        } catch (error: any) {
            toast.error(error?.message || "Failed to cleanup stale rounds", {
                id: "admin-round-cleanup",
            });
        } finally {
            setIsCleaning(false);
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
                    Admin starts rounds with deterministic roster selection: latest 4 eligible
                    ACTIVE agents by registration time. Stale active rounds can be cleaned before
                    launch to keep demo flow deterministic.
                </p>
            </motion.div>

            {/* Orchestrator Status — Pre-warm before demo */}
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.02 }}
                className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-4 ${
                    orchStatus === "awake"
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : orchStatus === "offline"
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-border bg-card"
                }`}
            >
                <div className="flex items-center gap-3">
                    <Server className={`h-4 w-4 ${
                        orchStatus === "awake" ? "text-emerald-400" : orchStatus === "offline" ? "text-amber-400" : "text-muted-foreground"
                    }`} />
                    <div>
                        <p className="text-sm font-medium text-foreground">
                            Orchestrator:{" "}
                            <span className={
                                orchStatus === "awake" ? "text-emerald-400" :
                                orchStatus === "offline" ? "text-amber-400" :
                                orchStatus === "waking" ? "text-blue-400" :
                                "text-muted-foreground"
                            }>
                                {orchStatus === "awake" ? "AWAKE" :
                                 orchStatus === "offline" ? "SLEEPING" :
                                 orchStatus === "waking" ? "WAKING UP..." :
                                 orchStatus === "checking" ? "CHECKING..." :
                                 "UNKNOWN"}
                            </span>
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                            {orchStatus === "awake" && orchUptime != null
                                ? `Up ${Math.floor(orchUptime / 60)}m · ${orchRoundsProcessed} rounds processed`
                                : orchStatus === "offline"
                                ? "Render free tier is sleeping — wake it before starting a round"
                                : orchStatus === "waking"
                                ? "Cold-starting on Render... this takes ~30-60 seconds"
                                : ""}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {orchStatus === "awake" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Ready
                        </span>
                    ) : orchStatus === "waking" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-400">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Waking
                        </span>
                    ) : (
                        <button
                            type="button"
                            onClick={() => void wakeOrchestrator()}
                            disabled={orchStatus === "checking"}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Zap className="h-3.5 w-3.5" />
                            Wake Orchestrator
                        </button>
                    )}
                </div>
            </motion.div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-border bg-card p-6 space-y-5"
                >
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-foreground">Round Config</h2>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void handleCleanupRounds()}
                                disabled={isCleaning}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isCleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                                Cleanup Stale
                            </button>
                            <button
                                type="button"
                                onClick={() => void refetch()}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Refresh
                            </button>
                        </div>
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
                        disabled={
                            isStarting ||
                            isLoading ||
                            (data?.selectedAgents?.length || 0) === 0 ||
                            (data?.activeRoundIds?.length || 0) > 0
                        }
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
                                Start Round (Latest 4 Active)
                            </>
                        )}
                    </button>

                    {(data?.activeRoundIds?.length || 0) > 0 ? (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                            Active round(s) in progress: {(data?.activeRoundIds || []).map((id) => `#${id}`).join(", ")}.
                            Finish or cleanup before starting a new round.
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
                            className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(80px,120px))] gap-3 items-center rounded-lg border border-border px-3 py-2 text-xs"
                        >
                            <div>
                                <div className="font-medium text-foreground">#{agent.id} {agent.name}</div>
                                <div className="text-muted-foreground truncate">{agent.description}</div>
                            </div>
                            <StatusBadge ok={agent.active} label="Active" />
                            <StatusBadge ok={agent.operatorOwned} label="Owned" />
                            <StatusBadge ok={agent.eligibleForAdminRounds} label="Eligible" />
                        </div>
                    ))}
                </div>
            </motion.section>

            {/* Round Started Modal */}
            {createdRound && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                        onClick={() => setCreatedRound(null)}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        className="relative w-full max-w-md rounded-2xl border border-primary/30 bg-card p-6 shadow-2xl"
                    >
                        {/* Close */}
                        <button
                            type="button"
                            onClick={() => setCreatedRound(null)}
                            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-4 w-4" />
                        </button>

                        {/* Header */}
                        <div className="flex items-center gap-3 mb-5">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                                <CheckCircle2 className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
                                    Round Started
                                </p>
                                <p className="text-lg font-bold text-foreground">
                                    Round #{createdRound.roundId}
                                </p>
                            </div>
                        </div>

                        {/* Details */}
                        <div className="space-y-3 text-sm">
                            {createdRound.startPriceUsd !== null && (
                                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                                    <span className="text-muted-foreground">Start Price</span>
                                    <span className="font-mono font-semibold text-foreground">
                                        ${createdRound.startPriceUsd.toFixed(4)} HBAR/USD
                                    </span>
                                </div>
                            )}

                            {createdRound.txHash && (
                                <a
                                    href={getTransactionUrl(createdRound.txHash) || createdRound.txHashscanUrl || "#"}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 hover:border-primary/40 transition-colors"
                                >
                                    <span className="text-muted-foreground">On-Chain TX</span>
                                    <span className="flex items-center gap-1.5 font-mono text-xs text-primary">
                                        {createdRound.txHash.slice(0, 18)}…
                                        <ExternalLink className="h-3 w-3" />
                                    </span>
                                </a>
                            )}

                            {/* Agents */}
                            <div className="rounded-lg border border-border bg-background px-3 py-2">
                                <p className="mb-2 text-xs text-muted-foreground">Participating Agents</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {createdRound.selectedAgents.map((a) => (
                                        <span
                                            key={a.id}
                                            className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary"
                                        >
                                            {a.name}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Orchestrator wake status */}
                            {createdRound.orchestratorWake && (
                                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                                    <span className="text-muted-foreground">Orchestrator</span>
                                    <span className={`font-mono text-xs ${
                                        createdRound.orchestratorWake.status === "woken"
                                            ? "text-emerald-400"
                                            : createdRound.orchestratorWake.status === "skipped"
                                            ? "text-muted-foreground"
                                            : "text-amber-400"
                                    }`}>
                                        {createdRound.orchestratorWake.status}
                                        {createdRound.orchestratorWake.error
                                            ? ` — ${createdRound.orchestratorWake.error}`
                                            : ""}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* CTA */}
                        <div className="mt-5 flex gap-2">
                            <Link
                                href={`/round/${createdRound.roundId}`}
                                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                                onClick={() => setCreatedRound(null)}
                            >
                                Watch Live Round
                            </Link>
                            <button
                                type="button"
                                onClick={() => setCreatedRound(null)}
                                className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30"
                            >
                                Dismiss
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
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
