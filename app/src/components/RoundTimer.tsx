import { useEffect, useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";

interface RoundTimerProps {
  endTime: number;
  phase: string;
}

export default function RoundTimer({ endTime, phase }: RoundTimerProps) {
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

  const isFinished = phase === "resolved" || phase === "cancelled";

  const phaseConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    committing: {
      label: "AGENTS ANALYZING",
      color: "text-amber-400",
      icon: <Clock className="h-3.5 w-3.5 text-amber-400 animate-pulse" />,
    },
    revealing: {
      label: "DECRYPTING INTEL",
      color: "text-primary",
      icon: <Clock className="h-3.5 w-3.5 text-primary animate-pulse" />,
    },
    resolved: {
      label: "ROUND RESOLVED",
      color: "text-success",
      icon: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
    },
    cancelled: {
      label: "CANCELLED",
      color: "text-muted-foreground",
      icon: null,
    },
  };

  const config = phaseConfig[phase] || { label: phase.toUpperCase(), color: "text-muted-foreground", icon: null };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        {config.icon}
        <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${config.color}`}>
          {config.label}
        </div>
      </div>
      <div className="font-mono text-2xl font-bold tabular-nums text-foreground">
        {isFinished ? "✓" : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`}
      </div>
    </div>
  );
}
