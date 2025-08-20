import { Address, Hash } from "viem";
import { SessionSigner } from "../interfaces";
import { PrivyClient } from "@privy-io/server-auth"

export interface PrivySessionSignerConfig {
  walletId: string;
  walletAddress: Address;
  privyAppId: string;
  privyAppSecret: string;
  sessionSignerPrivateKey: string;
  chainId?: number;
}

/**
 * Backend Session Signer for Privy wallets
 * Uses REST API for server-side signing
 */
export class PrivySessionSigner implements SessionSigner {
  public readonly signerId: string;
  public readonly address: Address;
  private readonly chainId: number;
  private readonly caip2: string;
  
  constructor(private config: PrivySessionSignerConfig) {
    this.signerId = config.walletId;
    this.address = config.walletAddress;
    this.chainId = config.chainId || 84532; // Base Sepolia
    this.caip2 = `eip155:${this.chainId}`;
  }


  /**
   * Transfer funds from agent wallet to user wallet
   * Uses the existing sendTransaction method
   */
  async transferFunds(toAddress: Address, amount: bigint): Promise<Hash> {
    const tx = {
      to: toAddress,
      value: amount,
      data: '0x' // Empty data for simple ETH transfer
    };
    
    return this.sendTransaction(tx);
  }

  /**
   * Send transaction using Privy server SDK with authorization key
   */
  async sendTransaction(tx: any): Promise<Hash> {
    if (!this.config.sessionSignerPrivateKey) {
      throw new Error('Private key is required for backend transactions');
    }
    
    try {
      const privy = new PrivyClient(this.config.privyAppId, this.config.privyAppSecret);
      await privy.walletApi.updateAuthorizationKey(this.config.sessionSignerPrivateKey);

      const caip2 = `eip155:${this.chainId}` as `eip155:${string}`; // e.g., "eip155:84532" for Base Sepolia

      const result = await privy.walletApi.ethereum.sendTransaction({
        walletId: this.signerId,
        caip2,
        transaction: {
          from: this.address,
          to: tx.to,
          value: tx.value ? `0x${BigInt(tx.value).toString(16)}` as `0x${string}` : undefined,
          data: (tx.data || '0x') as `0x${string}`,
          gasLimit: tx.gas ? `0x${BigInt(tx.gas).toString(16)}` as `0x${string}` : undefined,
          maxFeePerGas: tx.maxFeePerGas ? `0x${BigInt(tx.maxFeePerGas).toString(16)}` as `0x${string}` : undefined,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? `0x${BigInt(tx.maxPriorityFeePerGas).toString(16)}` as `0x${string}` : undefined
        }
      }).catch((sendError: any) => {
        console.error('❌ Transaction send failed:', sendError.message);
        if (sendError.message.includes('Invalid Privy app id')) {
          console.error('App ID validation failed at transaction time');
          console.error('App ID being used:', this.config.privyAppId);
        }
        throw sendError;
      });
      
      const txHash = result.hash || result;
      
      if (!txHash) {
        throw new Error('Transaction hash not found in response');
      }
      
      console.log('Transaction sent successfully:', txHash);
      return txHash as Hash;
      
    } catch (error: any) {
      console.error('Failed to send transaction:', error);
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }
}