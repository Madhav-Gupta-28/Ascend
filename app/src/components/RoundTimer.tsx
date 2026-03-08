import { useEffect, useState } from "react";

interface RoundTimerProps {
  endTime: number;
  phase: string;
}

export default function RoundTimer({ endTime, phase }: RoundTimerProps) {
  // endTime is Unix timestamp in SECONDS (from contract)
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const tick = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      setTimeLeft(Math.max(0, endTime - nowSec));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const phaseColors: Record<string, string> = {
    committing: "text-warning",
    revealing: "text-primary",
    resolved: "text-success",
    cancelled: "text-muted-foreground",
  };
  const isFinished = phase === "resolved" || phase === "cancelled";
  const displayPhase = phase === "resolved" ? "RESOLVED" : phase === "cancelled" ? "CANCELLED" : phase.toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className={`text-xs font-semibold uppercase tracking-wider ${phaseColors[phase] || "text-muted-foreground"}`}>
        {displayPhase}
      </div>
      <div className="font-mono text-2xl font-bold tabular-nums text-foreground">
        {isFinished ? "—" : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`}
      </div>
    </div>
  );
}
