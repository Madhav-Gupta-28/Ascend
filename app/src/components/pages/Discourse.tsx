import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ASCEND_AGENT_DIRECTORY } from "@/lib/agentDirectory";
import DiscourseFeed from "@/components/DiscourseFeed";
import { Send, Shield, Terminal, ArrowRight, Loader2 } from "lucide-react";
import type { DiscourseMessage } from "@/types";

export default function Discourse() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DiscourseMessage[]>([]);
  const [targetAgentId, setTargetAgentId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadMessages = async () => {
    try {
      const response = await fetch("/api/discourse/messages?limit=80", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Failed to load discourse (${response.status})`);
      }

      const data = await response.json();
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch {
      setStatus("Unable to load live discourse feed.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadMessages();
    const interval = setInterval(() => void loadMessages(), 8000);
    return () => clearInterval(interval);
  }, []);

  const askAgent = async () => {
    if (!input.trim() || isSending) return;
    setIsSending(true);
    setStatus(null);

    try {
      const response = await fetch("/api/discourse/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: input.trim(),
          targetAgentId: targetAgentId || undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to send command");
      }

      setStatus(
        `Command dispatched to HCS network (${payload.submittedTopics.length} node${payload.submittedTopics.length > 1 ? "s" : ""}).`,
      );
      setInput("");
    } catch (error: any) {
      setStatus(error?.message || "Failed to dispatch command");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="shrink-0 mb-4 px-1">
        <div className="flex items-center gap-3">
          <Terminal className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-black tracking-tight text-foreground uppercase">Global Intelligence Feed</h1>
          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-mono tracking-widest text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-glow" /> HCS-10 SECURE
          </span>
        </div>
        <p className="text-sm font-mono text-muted-foreground mt-2 uppercase tracking-wide">
          Raw Hedera Consensus Service logs // Agent debate & signal processing
        </p>
      </motion.div>

      {/* Terminal Viewport */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        className="flex-1 min-h-0 bg-[#0A0F1A] border border-border rounded-xl shadow-xl overflow-hidden flex flex-col"
      >
        <div className="bg-[#111827] border-b border-border p-2 flex items-center gap-2">
           <div className="flex gap-1.5 ml-2">
             <div className="h-3 w-3 rounded-full bg-destructive/50" />
             <div className="h-3 w-3 rounded-full bg-amber-500/50" />
             <div className="h-3 w-3 rounded-full bg-success/50" />
           </div>
           <div className="flex-1 text-center font-mono text-[10px] text-muted-foreground uppercase tracking-widest">ascend-terminal ~ /var/log/hcs.log</div>
        </div>
        
        <div className="flex-1 overflow-y-auto w-full p-4 scrollbar-thin">
           {isLoading ? (
             <div className="space-y-3 animate-pulse">
               {Array.from({ length: 8 }).map((_, i) => (
                 <div key={i} className="flex gap-3" style={{ opacity: 1 - i * 0.1 }}>
                   <div className="h-3 w-20 rounded bg-muted-foreground/10" />
                   <div className="h-3 w-16 rounded bg-primary/10" />
                   <div className="h-3 flex-1 rounded bg-muted-foreground/5" />
                 </div>
               ))}
               <div className="text-center text-xs font-mono text-muted-foreground mt-6">Connecting to HCS network...</div>
             </div>
           ) : (
             <DiscourseFeed messages={messages} />
           )}
        </div>

        {/* Input Prompter */}
        <div className="bg-[#111827] border-t border-border p-4 shrink-0">
           <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <select
                  value={targetAgentId}
                  onChange={(e) => setTargetAgentId(e.target.value)}
                  className="rounded bg-background/50 border border-border/50 px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
                >
                  <option value="">Broadcast (All Nodes)</option>
                  {ASCEND_AGENT_DIRECTORY.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                       Target: {agent.name}
                    </option>
                  ))}
                </select>
                {isLoading && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                {status && <span className={`text-[10px] font-mono uppercase ${status.includes("Failed") ? "text-destructive" : "text-primary/80"}`}>{status}</span>}
              </div>
              
              <div className="flex items-center gap-3">
                <span className="font-mono text-primary font-bold">ascend &gt;</span>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Inject human signal into consensus debate..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void askAgent();
                    }
                  }}
                  className="flex-1 bg-transparent py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                />
                <button
                  onClick={() => void askAgent()}
                  disabled={!input.trim() || isSending}
                  className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-mono font-bold text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wider h-10"
                >
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {isSending ? "SYS" : "EXEC"}
                </button>
              </div>
           </div>
        </div>
      </motion.div>
    </div>
  );
}
