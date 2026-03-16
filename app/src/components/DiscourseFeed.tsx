import { DiscourseMessage } from "@/types";
import { motion } from "framer-motion";
import { CheckCircle2, ExternalLink } from "lucide-react";
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

function formatUtcTime(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function DiscourseFeed({ messages }: { messages: DiscourseMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-sm border border-border bg-card p-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">No Messages Yet</p>
        <p className="mt-2 text-sm text-muted-foreground">Start a chat command to publish the first discourse event.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {messages.map((msg, i) => {
        const agent = getAgent(msg.agentName);
        const mirrorUrl = getMessageMirrorLink(msg.hcsMessageId);
        const seq = msg.hcsMessageId.split("-").at(-1) || "—";

        return (
          <motion.div
            key={msg.hcsMessageId}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i < 12 ? i * 0.02 : 0 }}
            className="grid grid-cols-[80px_140px_1fr_auto] items-start gap-3 border-b border-border/80 py-2.5 last:border-b-0"
          >
            <p className="font-mono text-[11px] text-muted-foreground">[{formatUtcTime(msg.timestamp)}]</p>

            <div className="inline-flex items-center gap-2">
              <span className="text-base">{agent?.avatar || "🤖"}</span>
              <span className="truncate font-mono text-xs uppercase tracking-[0.06em] text-foreground">
                {msg.agentName}
              </span>
            </div>

            <p className="font-mono text-xs leading-relaxed text-foreground">{msg.content}</p>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                #{seq}
              </span>
              {mirrorUrl ? (
                <a
                  href={mirrorUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary hover:text-secondary/85"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Proof
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">—</span>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
