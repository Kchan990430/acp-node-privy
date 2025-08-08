import { Address, encodeFunctionData, erc20Abi, Hash, PublicClient } from "viem";
import { SessionSigner } from "../interfaces";

export interface TransferFundsParams {
  sessionSigner: SessionSigner;
  toAddress: Address;
  amount: bigint;
  tokenAddress?: Address;
  isNativeToken?: boolean;
}

/**
 * Transfer funds from agent wallet to any address
 * Supports both native tokens (ETH) and ERC20 tokens
 */
export async function transferFunds({
  sessionSigner,
  toAddress,
  amount,
  tokenAddress,
  isNativeToken = false
}: TransferFundsParams): Promise<Hash> {
  
  if (isNativeToken || !tokenAddress) {
    // Transfer native token (ETH)
    console.log('💸 Transferring native token:', {
      from: sessionSigner.address,
      to: toAddress,
      amount: amount.toString()
    });
    
    const txHash = await sessionSigner.sendTransaction({
      to: toAddress,
      value: amount,
      data: "0x" as `0x${string}`,
    });
    
    console.log('✅ Native token transfer sent:', txHash);
    return txHash;
  } else {
    // Transfer ERC20 token
    console.log('💸 Transferring ERC20 token:', {
      from: sessionSigner.address,
      to: toAddress,
      tokenAddress,
      amount: amount.toString()
    });
    
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [toAddress, amount],
    });

    const txHash = await sessionSigner.sendTransaction({
      to: tokenAddress,
      data,
      value: BigInt(0),
    });
    
    console.log('✅ ERC20 transfer sent:', txHash);
    return txHash;
  }
}

/**
 * Get token balance for an address
 * Supports both native tokens and ERC20 tokens
 */
export async function getBalance(
  address: Address,
  publicClient: PublicClient,
  tokenAddress?: Address
): Promise<bigint> {
  if (!tokenAddress) {
    // Get native token balance
    const balance = await publicClient.getBalance({ address });
    console.log('💰 Native balance:', {
      address,
      balance: balance.toString()
    });
    return balance;
  } else {
    // Get ERC20 token balance
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }) as bigint;
    
    console.log('💰 ERC20 balance:', {
      address,
      tokenAddress,
      balance: balance.toString()
    });
    return balance;
  }
}

/**
 * Approve ERC20 token spending
 * Required before transferring tokens on behalf of another address
 */
export async function approveTokenSpending(
  sessionSigner: SessionSigner,
  tokenAddress: Address,
  spenderAddress: Address,
  amount: bigint
): Promise<Hash> {
  console.log('🔓 Approving token spending:', {
    tokenAddress,
    spender: spenderAddress,
    amount: amount.toString()
  });
  
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spenderAddress, amount],
  });

  const txHash = await sessionSigner.sendTransaction({
    to: tokenAddress,
    data,
    value: BigInt(0),
  });
  
  console.log('✅ Approval sent:', txHash);
  return txHash;
}

/**
 * Transfer all balance from agent wallet to another address
 * Useful for withdrawing all funds from an agent
 */
export async function transferAllBalance(
  sessionSigner: SessionSigner,
  publicClient: PublicClient,
  toAddress: Address,
  tokenAddress?: Address,
  keepGasReserve: bigint = BigInt(0)
): Promise<Hash> {
  const balance = await getBalance(sessionSigner.address, publicClient, tokenAddress);
  
  if (balance === BigInt(0)) {
    throw new Error('No balance to transfer');
  }
  
  let amountToTransfer = balance;
  
  // For native token transfers, keep some for gas
  if (!tokenAddress && keepGasReserve > 0) {
    if (balance <= keepGasReserve) {
      throw new Error('Balance is less than or equal to gas reserve');
    }
    amountToTransfer = balance - keepGasReserve;
  }
  
  console.log('📤 Transferring all balance:', {
    balance: balance.toString(),
    amountToTransfer: amountToTransfer.toString(),
    keepGasReserve: keepGasReserve.toString()
  });
  
  return transferFunds({
    sessionSigner,
    toAddress,
    amount: amountToTransfer,
    tokenAddress,
    isNativeToken: !tokenAddress
  });
}