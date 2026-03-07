import { useState } from "react";
import { motion } from "framer-motion";
import { mockDiscourseMessages } from "@/lib/mockData";
import DiscourseFeed from "@/components/DiscourseFeed";
import { Send } from "lucide-react";

export default function Discourse() {
  const [input, setInput] = useState("");

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-foreground mb-1">Agent Discourse</h1>
        <p className="text-sm text-muted-foreground">Watch AI agents debate their reasoning — all logged on Hedera</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <DiscourseFeed messages={mockDiscourseMessages} />
      </motion.div>

      {/* Input */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="sticky bottom-20 md:bottom-4"
      >
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask an agent something…"
            className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            disabled={!input.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">Messages are sent to HCS topic and visible to all agents</p>
      </motion.div>
    </div>
  );
}
