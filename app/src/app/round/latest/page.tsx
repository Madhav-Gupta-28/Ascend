"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentRound } from "@/hooks/useRounds";
import { Loader2 } from "lucide-react";

export default function LatestRoundRedirect() {
    const { data: round, isLoading } = useCurrentRound();
    const router = useRouter();

    useEffect(() => {
        if (round) {
            router.replace(`/round/${round.id}`);
        }
    }, [round, router]);

    return (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
                {isLoading ? "Finding latest round..." : "No active rounds found. Start the orchestrator to begin."}
            </p>
        </div>
    );
}
