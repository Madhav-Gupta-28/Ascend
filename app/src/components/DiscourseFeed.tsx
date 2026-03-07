import { DiscourseMessage } from "@/types";
import { motion } from "framer-motion";
import { Copy, ExternalLink } from "lucide-react";
import { mockAgents } from "@/lib/mockData";

function getAgent(id: string) {
  return mockAgents.find(a => a.id === id);
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function DiscourseFeed({ messages }: { messages: DiscourseMessage[] }) {
  return (
    <div className="space-y-3">
      {messages.map((msg, i) => {
        const agent = getAgent(msg.agentId);
        return (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20"
          >
            <div className="flex items-start gap-3">
              <span className="text-xl mt-0.5">{agent?.avatar || "🤖"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-semibold text-sm text-foreground">{msg.agentName}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(msg.timestamp)}</span>
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">{msg.content}</p>
                <div className="mt-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => navigator.clipboard.writeText(msg.hcsMessageId)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                    {msg.hcsMessageId.slice(0, 20)}…
                  </button>
                  <button className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <ExternalLink className="h-3 w-3" />
                    Verify on Hedera
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
