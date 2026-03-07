import { NextRequest, NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DiscourseMessage } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MirrorTopicMessage {
  consensus_timestamp: string;
  message: string;
  sequence_number: number;
}

interface AgentStateConnection {
  status?: string;
  connectionTopicId?: string;
}

interface AgentStateFile {
  connections?: Record<string, AgentStateConnection>;
}

function decodeBase64Json(raw: string): any | null {
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function consensusToIso(consensusTs: string): string {
  const [secondsRaw, nanosRaw = "0"] = consensusTs.split(".");
  const seconds = Number(secondsRaw);
  const nanos = Number(nanosRaw.padEnd(9, "0").slice(0, 9));
  const millis = seconds * 1000 + Math.floor(nanos / 1_000_000);
  return new Date(millis).toISOString();
}

function normalizeAgent(raw: string): { agentId: string; agentName: string } {
  const value = (raw || "").trim().toLowerCase();
  const normalized =
    value === "1" || value.includes("sentinel")
      ? "sentinel"
      : value === "2" || value.includes("pulse")
        ? "pulse"
        : value === "3" || value.includes("meridian")
          ? "meridian"
          : value === "4" || value.includes("oracle")
            ? "oracle"
            : value || "unknown";

  const agentName = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return { agentId: normalized, agentName };
}

function toDiscourseMessage(topicId: string, msg: MirrorTopicMessage): DiscourseMessage | null {
  const data = decodeBase64Json(msg.message);
  if (!data || typeof data !== "object") return null;

  if (data.type === "REASONING") {
    const { agentId, agentName } = normalizeAgent(String(data.agentId || "unknown"));
    const confidence = typeof data.confidence === "number" ? ` (${data.confidence}%)` : "";
    const reasoning = typeof data.reasoning === "string" ? data.reasoning : "";
    if (!reasoning) return null;

    return {
      id: `reasoning-${msg.sequence_number}`,
      agentId,
      agentName,
      content: `${reasoning}${confidence}`,
      timestamp: consensusToIso(msg.consensus_timestamp),
      hcsMessageId: `${topicId}-${msg.sequence_number}`,
    };
  }

  if (data.type === "DISCOURSE") {
    const { agentId, agentName } = normalizeAgent(String(data.from || "unknown"));
    const content = typeof data.message === "string" ? data.message : "";
    if (!content) return null;

    return {
      id: `discourse-${msg.sequence_number}`,
      agentId,
      agentName,
      content,
      timestamp: consensusToIso(msg.consensus_timestamp),
      hcsMessageId: `${topicId}-${msg.sequence_number}`,
      isReply: data.replyTo != null,
      replyTo: data.replyTo != null ? String(data.replyTo) : undefined,
    };
  }

  return null;
}

function readConnectionTopicsFromState(agentNumericId: string): string[] {
  const stateFilePath = path.resolve(
    process.cwd(),
    "..",
    "agents",
    ".cache",
    `hcs10_${agentNumericId}_state.json`,
  );

  if (!fs.existsSync(stateFilePath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(stateFilePath, "utf-8")) as AgentStateFile;
    const connections = Object.values(data.connections || {});
    return connections
      .filter((conn) => conn.status === "active" && typeof conn.connectionTopicId === "string")
      .map((conn) => conn.connectionTopicId as string);
  } catch {
    return [];
  }
}

function readConnectionTopicsFromEnv(): string[] {
  const topics = new Set<string>();
  const rawJson = process.env.HCS10_CONNECTION_TOPICS_JSON;

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, string | string[]>;
      for (const value of Object.values(parsed)) {
        if (typeof value === "string") topics.add(value);
        if (Array.isArray(value)) value.forEach((topic) => topics.add(topic));
      }
    } catch {
      // ignored
    }
  }

  return Array.from(topics);
}

function resolveConnectionTopics(): string[] {
  const topics = new Set<string>();
  for (const topic of readConnectionTopicsFromEnv()) topics.add(topic);
  for (const id of ["1", "2", "3", "4"]) {
    for (const topic of readConnectionTopicsFromState(id)) topics.add(topic);
  }
  return Array.from(topics).filter((topicId) => /^\d+\.\d+\.\d+$/.test(topicId));
}

function toHCS10Message(topicId: string, msg: MirrorTopicMessage): DiscourseMessage | null {
  const envelope = decodeBase64Json(msg.message);
  if (!envelope || envelope.p !== "hcs-10" || envelope.op !== "message") return null;
  if (typeof envelope.data !== "string") return null;

  let payload: any;
  try {
    payload = JSON.parse(envelope.data);
  } catch {
    return null;
  }

  if (!payload || payload.protocol !== "ascend-hcs10" || typeof payload.kind !== "string") {
    return null;
  }

  const fromRaw = String(payload.fromAgentId || payload.fromAgentName || "unknown");
  const { agentId, agentName } = normalizeAgent(fromRaw);

  if (payload.kind === "reasoning.publish" && typeof payload.reasoning === "string") {
    return {
      id: `hcs10-reasoning-${topicId}-${msg.sequence_number}`,
      agentId,
      agentName,
      content: `${payload.reasoning}${typeof payload.confidence === "number" ? ` (${payload.confidence}%)` : ""}`,
      timestamp: consensusToIso(msg.consensus_timestamp),
      hcsMessageId: `${topicId}-${msg.sequence_number}`,
    };
  }

  if (payload.kind === "question.ask" && typeof payload.question === "string") {
    return {
      id: `hcs10-question-${topicId}-${msg.sequence_number}`,
      agentId,
      agentName,
      content: `Q: ${payload.question}`,
      timestamp: consensusToIso(msg.consensus_timestamp),
      hcsMessageId: `${topicId}-${msg.sequence_number}`,
    };
  }

  if (payload.kind === "question.answer" && typeof payload.answer === "string") {
    return {
      id: `hcs10-answer-${topicId}-${msg.sequence_number}`,
      agentId,
      agentName,
      content: `A: ${payload.answer}${typeof payload.confidence === "number" ? ` (${payload.confidence}%)` : ""}`,
      timestamp: consensusToIso(msg.consensus_timestamp),
      hcsMessageId: `${topicId}-${msg.sequence_number}`,
    };
  }

  return null;
}

export async function GET(req: NextRequest) {
  const mirrorNodeBase = process.env.HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com";
  const topicId = process.env.ASCEND_ROUNDS_TOPIC_ID;
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") || 80);
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 80));

  if (!topicId) {
    return NextResponse.json(
      { error: "ASCEND_ROUNDS_TOPIC_ID is not configured" },
      { status: 500 },
    );
  }

  const url = `${mirrorNodeBase}/api/v1/topics/${topicId}/messages?order=desc&limit=${limit}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return NextResponse.json(
      { error: `Mirror node request failed (${response.status})` },
      { status: 502 },
    );
  }

  const payload = await response.json();
  const roundMessages = ((payload?.messages || []) as MirrorTopicMessage[])
    .map((msg) => toDiscourseMessage(topicId, msg))
    .filter((msg): msg is DiscourseMessage => msg !== null);

  const connectionTopics = resolveConnectionTopics();
  const hcs10Messages = (
    await Promise.all(
      connectionTopics.map(async (connectionTopicId) => {
        const connectionUrl = `${mirrorNodeBase}/api/v1/topics/${connectionTopicId}/messages?order=desc&limit=30`;
        const connectionRes = await fetch(connectionUrl, { cache: "no-store" });
        if (!connectionRes.ok) return [] as DiscourseMessage[];
        const connectionPayload = await connectionRes.json();
        const messages = (connectionPayload?.messages || []) as MirrorTopicMessage[];
        return messages
          .map((msg) => toHCS10Message(connectionTopicId, msg))
          .filter((msg): msg is DiscourseMessage => msg !== null);
      }),
    )
  ).flat();

  const messages = [...roundMessages, ...hcs10Messages]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return NextResponse.json({ messages });
}
