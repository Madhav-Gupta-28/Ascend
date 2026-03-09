import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { createContractClient } from "./src/core/contract-client.js";

dotenv.config({ path: "../.env" });

async function main() {
    const contracts = createContractClient();
    
    console.log("Creating new round...");
    await contracts.createRound(300, 120, 600, 1000000n, 0);
    const roundId = Number(await contracts.market.getRoundCount()) - 1;
    console.log(`Checking new round ${roundId}`);
    
    const dir = 0; const conf = 80; const salt = ethers.randomBytes(32);
    const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "uint256", "bytes32"], [dir, conf, salt]));
    
    // Find an agent we own
    const myAddress = contracts.walletAddress.toLowerCase();
    let agentId = 0;
    for (let i = 1; i <= 10; i++) {
        try {
            const agentData = await contracts.getAgent(i);
            if (agentData.owner.toLowerCase() === myAddress) {
                agentId = i;
                break;
            }
        } catch (e) {}
    }
    console.log(`Using agentId ${agentId}`);
    
    try {
        await contracts.market.commitPrediction.staticCall(roundId, agentId, hash, { value: 0 });
        console.log("Static call succeeded. Executing transaction...");
        const tx = await contracts.market.commitPrediction(roundId, agentId, hash, { value: 0 });
        await tx.wait();
        console.log("Transaction succeeded!");
    } catch (e: any) {
        console.error("Revert reason:", e.reason);
        console.error(e);
    }
}
main().catch(console.error);
