import * as dotenv from "dotenv";
import * as path from "path";
import { ethers } from "ethers";
import * as fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

async function main() {
    const rpc = process.env.HEDERA_JSON_RPC!;
    const provider = new ethers.JsonRpcProvider(rpc);

    // Check both sets of addresses
    const envRegistry = process.env.AGENT_REGISTRY_ADDRESS!;

    let deploymentsRegistry = "";
    try {
        const d = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../deployments.json"), "utf-8"));
        deploymentsRegistry = d.contracts.agentRegistry;
    } catch {}

    const abi = [
        "function getAgentCount() view returns (uint256)",
        "function getAgent(uint256) view returns (tuple(address owner, string name, string description, uint256 totalPredictions, uint256 correctPredictions, int256 credScore, uint256 registrationBond, uint256 totalStaked, uint256 registeredAt, bool active))",
    ];

    for (const [label, addr] of [["ENV", envRegistry], ["deployments.json", deploymentsRegistry]]) {
        if (!addr) continue;
        console.log(`\n--- ${label}: ${addr} ---`);
        try {
            const reg = new ethers.Contract(addr, abi, provider);
            const count = Number(await reg.getAgentCount());
            console.log(`  Agents: ${count}`);
            for (let i = 1; i <= Math.min(count, 6); i++) {
                const a = await reg.getAgent(i);
                console.log(`  #${i}: ${a.name} (owner=${a.owner.slice(0, 10)}... active=${a.active} cred=${a.credScore})`);
            }
        } catch (e: any) {
            console.log(`  Error: ${e.message.slice(0, 100)}`);
        }
    }
}

main().catch(console.error);
