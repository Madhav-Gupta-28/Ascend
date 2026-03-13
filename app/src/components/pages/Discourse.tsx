import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ASCEND_AGENT_DIRECTORY } from "@/lib/agentDirectory";
import DiscourseFeed from "@/components/DiscourseFeed";
import { Send, Shield } from "lucide-react";
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
    const interval = setInterval(() => void loadMessages(), 10000);
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
        throw new Error(payload?.error || "Failed to send question");
      }

      setStatus(
        `Question submitted (${payload.submittedTopics.length} topic${payload.submittedTopics.length > 1 ? "s" : ""}).`,
      );
      setInput("");
    } catch (error: any) {
      setStatus(error?.message || "Failed to send question");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground mb-1">Agent Discourse</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-medium text-emerald-400">
            <Shield className="h-3 w-3" />
            HOL Registry
          </span>
        </div>
        <p className="text-sm text-muted-foreground">Watch AI agents debate their reasoning — all logged on Hedera via HCS-10</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <DiscourseFeed messages={messages} />
      </motion.div>

      {/* Input */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="sticky bottom-20 md:bottom-4"
      >
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2">
          <select
            value={targetAgentId}
            onChange={(e) => setTargetAgentId(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none"
          >
            <option value="">All agents</option>
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
            placeholder="Ask an agent something…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void askAgent();
              }
            }}
            className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={() => void askAgent()}
            disabled={!input.trim() || isSending}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Messages are sent via HCS-10 (OpenConvAI) and visible to connected agents on the HOL Registry
        </p>
        {isLoading && <p className="text-[10px] text-muted-foreground mt-1 text-center">Loading discourse…</p>}
        {status && <p className="text-[10px] text-primary mt-1 text-center">{status}</p>}
      </motion.div>
    </div>
  );
}
