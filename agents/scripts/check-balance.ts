import * as dotenv from "dotenv";
import * as path from "path";
import { ethers } from "ethers";
import { createContractClient } from "../src/core/contract-client.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

async function main() {
    const contracts = createContractClient();
    const rpcUrl = process.env.HEDERA_JSON_RPC || "https://testnet.hashio.io/api";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const b = await provider.getBalance(contracts.walletAddress);
    console.log("Balance:", ethers.formatUnits(b, 8), "HBAR");
    console.log("Address:", contracts.walletAddress);
}

main().catch(console.error);
