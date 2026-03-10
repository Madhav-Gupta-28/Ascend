import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI } from '@/lib/contracts';

export async function GET() {
    try {
        const rpcUrl =
            process.env.HEDERA_JSON_RPC ||
            process.env.NEXT_PUBLIC_HEDERA_JSON_RPC ||
            "https://testnet.hashio.io/api";
        const provider = new ethers.JsonRpcProvider(rpcUrl);

        if (!CONTRACT_ADDRESSES.agentRegistry) {
            throw new Error("Registry Address not set");
        }

        const registry = new ethers.Contract(CONTRACT_ADDRESSES.agentRegistry, AGENT_REGISTRY_ABI, provider);

        const count = Number(await registry.getAgentCount());

        if (count === 0) return NextResponse.json({ success: true, agents: [] });

        const promises = [];
        for (let i = 1; i <= count; i++) {
            promises.push(registry.getAgent(i).then((data: any) => ({
                agentId: i,
                name: data.name,
                credScore: Number(data.credScore),
                accuracy: Number(data.totalPredictions) > 0
                    ? Number(((Number(data.correctPredictions) / Number(data.totalPredictions)) * 100).toFixed(2))
                    : 0,
                stake: data.totalStaked.toString()
            })).catch(() => null));
        }

        const rawAgents = await Promise.all(promises);
        const agents = rawAgents.filter(a => a !== null) as any[];

        agents.sort((a, b) => {
            if (b.credScore !== a.credScore) return b.credScore - a.credScore;
            return b.accuracy - a.accuracy;
        });

        // Add rank
        const ranked = agents.map((a, i) => ({ ...a, rank: i + 1 }));

        return NextResponse.json({ success: true, agents: ranked });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
