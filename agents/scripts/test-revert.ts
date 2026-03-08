import { ethers } from "ethers";
import * as fs from "fs";

const REGISTRY_JSON = JSON.parse(fs.readFileSync("../contracts/out/AgentRegistry.sol/AgentRegistry.json", "utf-8"));
const registryAddr = "0xd4271ac5660dDE90b2E8c047D1c0942563392ade";
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

async function main() {
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const signer = new ethers.Wallet(privateKey as string, provider);
    const registry = new ethers.Contract(registryAddr, REGISTRY_JSON.abi, signer);

    try {
        console.log("Estimating gas...");
        await registry.registerAgent.estimateGas("TestAgent", "Desc", { value: ethers.parseEther("10") });
        console.log("Gas estimation SUCCESS");

        console.log("Executing tx...");
        const tx = await registry.registerAgent("TestAgent", "Desc", { value: ethers.parseEther("10"), gasLimit: 1_500_000 });
        const receipt = await tx.wait();
        console.log("Tx SUCCESS!", receipt?.hash);
    } catch (e: any) {
        console.error("Gas estimation failed:", e.reason || e.message);

        try {
            console.log("Trying static call...");
            await registry.registerAgent.staticCall("TestAgent", "Desc", { value: ethers.parseEther("10") });
            console.log("Static call SUCCESS (this means state revert is unlikely and it's a gas/fee issue)");
        } catch (e2: any) {
            console.error("Static call failed:", e2.reason || e2.message);
        }
    }
}
main().catch(console.error);
