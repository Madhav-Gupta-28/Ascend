import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

const REGISTRY_JSON = JSON.parse(fs.readFileSync("../contracts/out/AgentRegistry.sol/AgentRegistry.json", "utf-8"));
const registryAddr = "0x6444300d3b8b1647a349b2Be46dA6b48420773B9"; // Current AgentRegistry
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

async function main() {
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const signer = new ethers.Wallet(privateKey as string, provider);
    const registry = new ethers.Contract(registryAddr, REGISTRY_JSON.abi, signer);

    const count = await registry.getAgentCount();
    console.log("Current agent count:", count);

    const name = "Pulse";
    const desc = "Pulse Agent";

    try {
        console.log("Static call to register Pulse...");
        await registry.registerAgent.staticCall(name, desc, { value: ethers.parseEther("10") });
        console.log("Static call succeeded! Problem was gas or state.");

        console.log("Sending tx...");
        const tx = await registry.registerAgent(name, desc, { value: ethers.parseEther("10"), gasLimit: 2_000_000 });
        const receipt = await tx.wait();
        console.log("Tx succeeded in block:", receipt?.blockNumber);
    } catch (e: any) {
        console.error("Failed:", e.reason || e.message);
    }
}
main().catch(console.error);
