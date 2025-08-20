import { Address } from "viem";
import { baseSepolia, base } from "viem/chains";

type AcpContractConfig = {
  chain: typeof baseSepolia | typeof base;
  contractAddress: Address;
  virtualsTokenAddress: Address;
  paymentTokenAddress: Address;
  paymentTokenDecimals: number;
  acpUrl: string;
  alchemyRpcUrl: string;
  priorityFeeMultiplier: number;
  maxFeePerGas: number;
  maxPriorityFeePerGas: number;
  paymasterUrl?: string;
  bundlerUrl?: string;
};

const baseSepoliaAcpConfig: AcpContractConfig = {
  chain: baseSepolia,
  contractAddress: "0x8Db6B1c839Fc8f6bd35777E194677B67b4D51928",
  virtualsTokenAddress: "0xbfAB80ccc15DF6fb7185f9498d6039317331846a",
  paymentTokenAddress: "0xbfAB80ccc15DF6fb7185f9498d6039317331846a", // Same as virtualsTokenAddress for Base Sepolia
  paymentTokenDecimals: 18,
  alchemyRpcUrl: "https://alchemy-proxy.virtuals.io/api/proxy/rpc",
  acpUrl: "https://acpx.virtuals.gg",
  priorityFeeMultiplier: 2,
  maxFeePerGas: 20000000,
  maxPriorityFeePerGas: 21000000,
  // Optional: Configure with your Pimlico API key for gas sponsorship
  // paymasterUrl: "https://api.pimlico.io/v2/base-sepolia/rpc?apikey=YOUR_API_KEY",
  // bundlerUrl: "https://api.pimlico.io/v1/base-sepolia/rpc?apikey=YOUR_API_KEY",
};

const baseAcpConfig: AcpContractConfig = {
  chain: base,
  contractAddress: "0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A",
  virtualsTokenAddress: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
  paymentTokenAddress: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", // Same as virtualsTokenAddress for Base
  paymentTokenDecimals: 18,
  alchemyRpcUrl: "https://alchemy-proxy-prod.virtuals.io/api/proxy/rpc",
  acpUrl: "https://acpx.virtuals.io",
  priorityFeeMultiplier: 2,
  maxFeePerGas: 20000000,
  maxPriorityFeePerGas: 21000000,
};

export type { AcpContractConfig };
export { baseSepoliaAcpConfig, baseAcpConfig };
