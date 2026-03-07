import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  AccountId,
  Client,
  PrivateKey,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ALIAS_TO_NUMERIC: Record<string, string> = {
  sentinel: "1",
  pulse: "2",
  meridian: "3",
  oracle: "4",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
};

interface AskRequestBody {
  question?: string;
  targetAgentId?: string;
}

interface AgentStateConnection {
  status?: string;
  connectionTopicId?: string;
}

interface AgentStateFile {
  connections?: Record<string, AgentStateConnection>;
}

function parseHederaPrivateKey(raw: string): PrivateKey {
  try {
    return PrivateKey.fromString(raw);
  } catch {
    try {
      return PrivateKey.fromStringED25519(raw);
    } catch {
      return PrivateKey.fromStringECDSA(raw);
    }
  }
}

function normalizeTargetAgentId(target?: string): string | undefined {
  if (!target) return undefined;
  const key = target.trim().toLowerCase();
  return AGENT_ALIAS_TO_NUMERIC[key];
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

function readConnectionTopicsFromEnv(targetAgentNumeric?: string): string[] {
  const topics = new Set<string>();
  const rawJson = process.env.HCS10_CONNECTION_TOPICS_JSON;

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, string | string[]>;
      const keys = targetAgentNumeric ? [targetAgentNumeric] : Object.keys(parsed);
      for (const key of keys) {
        const value = parsed[key];
        if (typeof value === "string") topics.add(value);
        if (Array.isArray(value)) value.forEach((topic) => topics.add(topic));
      }
    } catch {
      // ignored; we still have file-based discovery fallback
    }
  }

  return Array.from(topics);
}

function resolveQuestionTopics(targetAgentNumeric?: string): string[] {
  const topics = new Set<string>();
  const candidates = targetAgentNumeric ? [targetAgentNumeric] : ["1", "2", "3", "4"];

  for (const topic of readConnectionTopicsFromEnv(targetAgentNumeric)) {
    topics.add(topic);
  }

  for (const id of candidates) {
    for (const topic of readConnectionTopicsFromState(id)) {
      topics.add(topic);
    }
  }

  return Array.from(topics).filter((topicId) => /^\d+\.\d+\.\d+$/.test(topicId));
}

function buildOperatorId(operatorAccountId: string): string {
  if (process.env.WEB_HCS10_OPERATOR_ID) return process.env.WEB_HCS10_OPERATOR_ID;
  const inboundTopicId = process.env.WEB_HCS10_INBOUND_TOPIC_ID || operatorAccountId;
  return `${inboundTopicId}@${operatorAccountId}`;
}

export async function POST(req: NextRequest) {
  let body: AskRequestBody;
  try {
    body = (await req.json()) as AskRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = (body.question || "").trim();
  if (!question) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }
  if (question.length > 700) {
    return NextResponse.json({ error: "Question too long (max 700 chars)" }, { status: 400 });
  }

  const targetAgentNumeric = normalizeTargetAgentId(body.targetAgentId);
  if (body.targetAgentId && !targetAgentNumeric) {
    return NextResponse.json({ error: "Unknown targetAgentId" }, { status: 400 });
  }

  const operatorAccountId = process.env.HEDERA_OPERATOR_ID;
  const operatorKeyRaw = process.env.HEDERA_OPERATOR_KEY;
  const network = process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";

  if (!operatorAccountId || !operatorKeyRaw) {
    return NextResponse.json(
      { error: "Missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY" },
      { status: 500 },
    );
  }

  const topicIds = resolveQuestionTopics(targetAgentNumeric);
  if (topicIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "No active HCS-10 connection topics found. Start agents first so they establish connections.",
      },
      { status: 409 },
    );
  }

  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(operatorAccountId),
    parseHederaPrivateKey(operatorKeyRaw),
  );

  const questionId = randomUUID();
  const payload = {
    protocol: "ascend-hcs10",
    version: "1.0.0",
    kind: "question.ask",
    messageId: randomUUID(),
    timestamp: Date.now(),
    fromAgentId: "user",
    fromAgentName: "Ascend User",
    questionId,
    question,
    targetAgentId: targetAgentNumeric,
  };

  const envelope = {
    p: "hcs-10",
    op: "message",
    operator_id: buildOperatorId(operatorAccountId),
    data: JSON.stringify(payload),
    m: "ascend:question.ask",
  };

  const submittedTopics: string[] = [];
  const failures: Array<{ topicId: string; error: string }> = [];

  for (const topicId of topicIds) {
    try {
      const tx = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(JSON.stringify(envelope));
      const response = await tx.execute(client);
      await response.getReceipt(client);
      submittedTopics.push(topicId);
    } catch (error: any) {
      failures.push({ topicId, error: error?.message || "submit failed" });
    }
  }

  client.close();

  if (submittedTopics.length === 0) {
    return NextResponse.json(
      { error: "Failed to submit question to any connection topic", failures },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    questionId,
    submittedTopics,
    failures,
  });
}
