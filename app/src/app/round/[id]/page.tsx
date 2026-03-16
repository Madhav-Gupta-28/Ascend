"use client";

import LiveRound from "@/components/pages/LiveRound";
import { useParams } from "next/navigation";

export default function Page() {
    const params = useParams();
    const rawId = typeof params?.id === "string" ? params.id : "";
    const roundId = Number.parseInt(rawId, 10);

    return <LiveRound roundId={Number.isFinite(roundId) ? roundId : undefined} />;
}
