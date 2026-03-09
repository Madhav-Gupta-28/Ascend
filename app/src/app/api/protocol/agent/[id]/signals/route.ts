import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: { id: string } }) {
    try {
        const id = Number(params.id);
        const topicId = process.env.NEXT_PUBLIC_HCS_TOPIC_ID;
        const mirrorUrl = process.env.NEXT_PUBLIC_HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com";

        if (!topicId) throw new Error("HCS topic ID not configured");

        const res = await fetch(`${mirrorUrl}/api/v1/topics/${topicId}/messages?limit=100&order=desc`);
        if (!res.ok) {
            throw new Error(`Mirror node returned ${res.status}`);
        }

        const data = await res.json();
        const signals = data.messages
            .map((m: any) => {
                try {
                    return {
                        timestamp: m.consensus_timestamp,
                        parsed: JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'))
                    };
                } catch (e) { return null; }
            })
            // Filter strictly for REVEALED predictions for this agent to preserve the black box prior to reveal
            .filter((p: any) => p && p.parsed && Number(p.parsed.agentId) === id && p.parsed.type === 'PREDICTION_REVEALED')
            .map((p: any) => ({
                timestamp: p.timestamp,
                roundId: p.parsed.roundId,
                direction: p.parsed.direction === 0 ? "UP" : "DOWN",
                confidence: p.parsed.confidence,
                reasoning: p.parsed.reasoning
            }));

        return NextResponse.json({ success: true, signals });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
