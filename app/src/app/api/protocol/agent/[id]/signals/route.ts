import { NextResponse } from 'next/server';

interface MirrorMessage {
    consensus_timestamp: string;
    message: string;
}

function decodeMessage(raw: string): any | null {
    try {
        return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
        return null;
    }
}

function normalizeAgentId(raw: unknown): string {
    const value = String(raw ?? '').trim().toLowerCase();
    if (value === '1' || value.includes('sentinel')) return '1';
    if (value === '2' || value.includes('pulse')) return '2';
    if (value === '3' || value.includes('meridian')) return '3';
    if (value === '4' || value.includes('oracle')) return '4';
    return value;
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const normalizedTarget = normalizeAgentId(id);
        const topicId =
            process.env.ASCEND_PREDICTIONS_TOPIC_ID ||
            process.env.NEXT_PUBLIC_PREDICTIONS_TOPIC_ID ||
            process.env.ASCEND_ROUNDS_TOPIC_ID ||
            process.env.NEXT_PUBLIC_ASCEND_ROUNDS_TOPIC_ID;
        const mirrorUrl =
            process.env.HEDERA_MIRROR_NODE ||
            process.env.NEXT_PUBLIC_HEDERA_MIRROR_NODE ||
            "https://testnet.mirrornode.hedera.com";

        if (!topicId) throw new Error("HCS topic ID not configured");

        const res = await fetch(`${mirrorUrl}/api/v1/topics/${topicId}/messages?limit=100&order=desc`);
        if (!res.ok) {
            throw new Error(`Mirror node returned ${res.status}`);
        }

        const data = await res.json();
        const signals = ((data.messages || []) as MirrorMessage[])
            .map((m) => {
                const parsed = decodeMessage(m.message);
                if (!parsed || parsed.type !== 'REASONING') return null;

                const parsedAgent = normalizeAgentId(parsed.agentId);
                if (parsedAgent !== normalizedTarget) return null;

                const direction =
                    parsed.direction === 'UP' || parsed.direction === 'DOWN'
                        ? parsed.direction
                        : null;
                const confidence =
                    typeof parsed.confidence === 'number' ? parsed.confidence : null;

                return {
                    timestamp: m.consensus_timestamp,
                    roundId: typeof parsed.roundId === 'number' ? parsed.roundId : null,
                    direction,
                    confidence,
                    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
                    revealed: direction !== null && confidence !== null,
                };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        return NextResponse.json({ success: true, signals });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
