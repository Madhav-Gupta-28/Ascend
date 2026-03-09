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
  const displayPhase =
    phase === "committing"
      ? "AGENTS LOCKING ANALYSIS"
      : phase === "revealing"
        ? "DECRYPTING INTELLIGENCE"
        : phase === "resolved"
          ? "RESOLUTION STRIKE"
          : phase === "cancelled"
            ? "CANCELLED"
            : phase.toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-full bg-muted/60 px-3 py-1.5">
      <div
        className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${phaseColors[phase] || "text-muted-foreground"
          }`}
      >
        {displayPhase}
      </div>
      <div className="font-mono text-2xl font-bold tabular-nums text-foreground animate-soft-pulse">
        {isFinished ? "—" : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`}
      </div>
    </div>
  );
}
