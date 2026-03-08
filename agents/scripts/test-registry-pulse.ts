import { ethers } from "ethers";
import { config } from "dotenv";
config({ path: "../app/.env" });
const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_HEDERA_JSON_RPC);
const registry = new ethers.Contract(process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS!, ["function getAgentCount() external view returns (uint256)"], provider);
registry.getAgentCount().then(console.log).catch(console.error);
