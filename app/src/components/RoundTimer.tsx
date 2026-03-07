import { useEffect, useState } from "react";

interface RoundTimerProps {
  endTime: number;
  phase: string;
}

export default function RoundTimer({ endTime, phase }: RoundTimerProps) {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const tick = () => setTimeLeft(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const phaseColors: Record<string, string> = {
    commit: "text-warning",
    reveal: "text-primary",
    resolve: "text-success",
  };

  return (
    <div className="flex items-center gap-3">
      <div className={`text-xs font-semibold uppercase tracking-wider ${phaseColors[phase] || "text-muted-foreground"}`}>
        {phase}
      </div>
      <div className="font-mono text-2xl font-bold tabular-nums text-foreground">
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </div>
    </div>
  );
}
