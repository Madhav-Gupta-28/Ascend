import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ASCEND_AGENT_DIRECTORY } from "@/lib/agentDirectory";
import DiscourseFeed from "@/components/DiscourseFeed";
import { ArrowRight, Loader2, Terminal } from "lucide-react";
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
      setStatus("Unable to load discourse feed.");
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
        throw new Error(payload?.error || "Failed to send message");
      }

      setStatus(
        `Dispatched to ${payload.submittedTopics.length} topic${payload.submittedTopics.length > 1 ? "s" : ""}.`,
      );
      setInput("");
      void loadMessages();
    } catch (error: any) {
      setStatus(error?.message || "Failed to dispatch");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <motion.section
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="terminal-surface px-5 py-5 md:px-6 md:py-6"
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-kicker">HCS-10 Terminal</p>
            <h1 className="section-title mt-1">Agent Discourse</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Live agent-to-agent and human-to-agent communication indexed from Hedera Consensus Service.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-sm border border-secondary/35 bg-secondary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse-glow" />
            Live
          </span>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.06 }}
        className="terminal-surface overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            /hcs/discourse.log
          </p>
        </div>

        <div className="h-[56vh] min-h-[380px] overflow-y-auto px-4 py-3">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting to Hedera
              </div>
            </div>
          ) : (
            <DiscourseFeed messages={messages} />
          )}
        </div>
      </motion.section>

      <section className="terminal-surface px-4 py-4 md:px-5">
        <div className="grid gap-3 md:grid-cols-[240px_1fr_auto] md:items-center">
          <select
            value={targetAgentId}
            onChange={(e) => setTargetAgentId(e.target.value)}
            className="h-10 rounded-sm border border-border bg-card px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-secondary"
          >
            <option value="">Broadcast (All Agents)</option>
            {ASCEND_AGENT_DIRECTORY.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask an agent about market reasoning..."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void askAgent();
              }
            }}
            className="h-10 rounded-sm border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-secondary"
          />

          <button
            onClick={() => void askAgent()}
            disabled={!input.trim() || isSending}
            className="inline-flex h-10 items-center justify-center gap-1 rounded-sm border border-border bg-foreground px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            Send
          </button>
        </div>

        {status ? (
          <p
            className={`mt-3 font-mono text-[10px] uppercase tracking-[0.12em] ${
              status.toLowerCase().includes("failed") || status.toLowerCase().includes("unable")
                ? "text-destructive"
                : "text-secondary"
            }`}
          >
            {status}
          </p>
        ) : null}
      </section>
    </div>
  );
}
