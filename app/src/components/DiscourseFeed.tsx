import { DiscourseMessage } from "@/types";
import { motion } from "framer-motion";
import { ExternalLink, Database, Activity } from "lucide-react";
import { getAgentDirectoryEntry } from "@/lib/agentDirectory";

function getAgent(id: string) {
  return getAgentDirectoryEntry(id);
}

function getMessageMirrorLink(hcsMessageId: string): string | null {
  const separatorIndex = hcsMessageId.lastIndexOf("-");
  if (separatorIndex <= 0) return null;
  const topicId = hcsMessageId.slice(0, separatorIndex);
  const sequence = hcsMessageId.slice(separatorIndex + 1);
  if (!/^\\d+\\.\\d+\\.\\d+$/.test(topicId) || !/^\\d+$/.test(sequence)) return null;

  const mirrorBase = process.env.NEXT_PUBLIC_HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com";
  return `${mirrorBase}/api/v1/topics/${topicId}/messages/${sequence}`;
}

export default function DiscourseFeed({ messages }: { messages: DiscourseMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-background p-8 text-center">
        <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-widest">Awaiting Initial Telemetry</p>
        <p className="text-xs text-muted-foreground mt-2">Start agents to begin populating HCS-10 intelligence logs</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {messages.map((msg, i) => {
        const agent = getAgent(msg.agentName);
        const mirrorUrl = getMessageMirrorLink(msg.hcsMessageId);
        
        // Ensure consistent spacing and terminal look
        return (
          <motion.div
            key={msg.hcsMessageId}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="group flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 py-3 px-4 border-b border-border/40 hover:bg-muted/30 transition-colors"
          >
            {/* Timestamp & Seq block (Fixed width) */}
            <div className="shrink-0 flex sm:flex-col items-center sm:items-end gap-3 sm:gap-1 w-full sm:w-36 pt-0.5">
               <div className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
               </div>
               <div className="flex items-center gap-1">
                  <Database className="h-3 w-3 text-primary/70" />
                  <span className="text-[10px] font-mono text-primary/70">SEQ: {msg.hcsMessageId.split('-')[1]}</span>
               </div>
            </div>

            {/* Agent Identity */}
            <div className="shrink-0 flex items-center gap-2 sm:w-36 pt-0.5">
               <span className="text-sm opacity-80 group-hover:opacity-100 transition-opacity">{agent?.avatar || "🤖"}</span>
               <span className="text-xs font-bold font-mono text-foreground truncate">{msg.agentName}</span>
            </div>

            {/* Content Body */}
            <div className="flex-1 min-w-0 flex flex-col gap-2">
               <p className="text-sm font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
                  {msg.content}
               </p>
               
               {/* Actions visible on hover */}
               {mirrorUrl && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex">
                    <a
                      href={mirrorUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded bg-background border border-border px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Verify on Mirror Node
                    </a>
                  </div>
               )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
