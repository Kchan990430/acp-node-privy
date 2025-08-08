import { Address, Hash } from "viem";
import { SessionSigner } from "../interfaces";

export interface PrivySessionSignerConfig {
  walletId: string;
  walletAddress: Address;
  privyAppId: string;
  privyAppSecret: string;
  sessionSignerPrivateKey: string; // Private key for backend control (PEM or wallet-auth:BASE64 format)
  chainId?: number; // Default to Base Sepolia (84532)
}

/**
 * Backend Session Signer for Privy wallets
 * Uses PrivyClient from @privy-io/server-auth for server-side signing
 */
export class PrivySessionSigner implements SessionSigner {
  public readonly signerId: string;
  public readonly address: Address;
  private readonly chainId: number;
  private readonly caip2: string;
  private privyClient: any; // Will be initialized dynamically
  
  constructor(private config: PrivySessionSignerConfig) {
    this.signerId = config.walletId;
    this.address = config.walletAddress;
    this.chainId = config.chainId || 84532; // Base Sepolia
    this.caip2 = `eip155:${this.chainId}`;
    
    // Lazy load PrivyClient to avoid build-time issues
    this.initPrivyClient();
  }
  
  private async initPrivyClient() {
    try {
      // Dynamic import to avoid build-time issues
      const { PrivyClient } = await import('@privy-io/server-auth');
      this.privyClient = new PrivyClient(
        this.config.privyAppId,
        this.config.privyAppSecret, 
        { 
          walletApi: {
            authorizationPrivateKey: this.extractPrivateKey(this.config.sessionSignerPrivateKey)
          }
        }
      );
    } catch (error) {
      console.error('Failed to initialize PrivyClient:', error);
      // Fallback to direct API calls if PrivyClient fails to load
      this.privyClient = null;
    }
  }
  
  /**
   * Extract private key from session signer secret
   * Supports both wallet-auth:BASE64 format and direct PEM format
   */
  private extractPrivateKey(sessionSignerPrivateKey: string): string {
    if (!sessionSignerPrivateKey) {
      throw new Error('Session signer private key is required');
    }
    
    // If it's already in the expected format, return as-is
    // PrivyClient expects the key in the same format as provided in environment
    return sessionSignerPrivateKey;
  }

  /**
   * Sign transaction using PrivyClient
   * Note: Privy may not support eth_signTransaction directly, we'll use sendTransaction instead
   */
  async signTransaction(tx: any): Promise<string> {
    // For now, we'll throw an error as Privy doesn't expose signing without sending
    // The ACP SDK should use sendTransaction directly
    throw new Error('PrivySessionSigner does not support signing without sending. Use sendTransaction instead.');
  }

  /**
   * Send transaction using PrivyClient or fallback to direct API
   * PrivyClient handles authorization automatically with sessionSignerPrivateKey
   */
  async sendTransaction(tx: any): Promise<Hash> {
    // Wait for PrivyClient to be initialized
    if (!this.privyClient) {
      await this.initPrivyClient();
    }
    
    // If PrivyClient is available, use it
    if (this.privyClient) {
      try {
        console.log('Sending transaction via PrivyClient:', {
          walletId: this.signerId,
          walletAddress: this.address,
          to: tx.to,
          value: tx.value,
          chainId: this.chainId
        });

        const result = await this.privyClient.walletApi.rpc({
          walletId: this.signerId,
          method: 'eth_sendTransaction',
          params: {
            transaction: {
              to: tx.to,
              value: `0x${(BigInt(tx.value || 0)).toString(16)}`,
              ...(tx.data && tx.data !== '0x' ? { data: tx.data } : {}),
              ...(tx.gas && { gas: `0x${(BigInt(tx.gas)).toString(16)}` }),
              ...(tx.maxFeePerGas && { maxFeePerGas: `0x${(BigInt(tx.maxFeePerGas)).toString(16)}` }),
              ...(tx.maxPriorityFeePerGas && { maxPriorityFeePerGas: `0x${(BigInt(tx.maxPriorityFeePerGas)).toString(16)}` })
            }
          },
          caip2: this.caip2 as `eip155:${string}`
        });

        // Handle different response formats
        const txHash = (result as any).hash || (result as any).data?.hash || (result as any).data?.txHash || (result as any).result || result;
        
        if (!txHash) {
          throw new Error('Transaction hash not found in Privy response');
        }
        
        console.log('Transaction sent successfully:', txHash);
        return txHash as Hash;
      } catch (error: any) {
        if (error.message?.includes('authorization')) {
          throw new Error(`Authorization failed. Ensure:
1. Authorization key is registered in Privy Dashboard
2. Key is linked to this wallet
3. Private key matches the registered public key
Error: ${error.message}`);
        }
        throw new Error(`Privy transaction failed: ${error.message || error}`);
      }
    }
    
    // Fallback to direct API if PrivyClient is not available
    return this.sendTransactionDirectAPI(tx);
  }
  
  /**
   * Fallback method using direct Privy API
   */
  private async sendTransactionDirectAPI(tx: any): Promise<Hash> {
    const basicAuth = Buffer.from(`${this.config.privyAppId}:${this.config.privyAppSecret}`).toString('base64');
    const apiUrl = 'https://api.privy.io/v1';
    
    const requestBody = JSON.stringify({
      method: 'eth_sendTransaction',
      caip2: this.caip2,
      chain_type: 'ethereum',
      params: {
        transaction: {
          to: tx.to,
          value: `0x${(BigInt(tx.value || 0)).toString(16)}`,
          ...(tx.data && tx.data !== '0x' ? { data: tx.data } : {})
        }
      }
    });
    
    const headers: any = {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
      'privy-app-id': this.config.privyAppId,
    };
    
    // Generate and add authorization signature
    const authSignature = this.generateAuthorizationSignature(
      'POST', 
      `${apiUrl}/wallets/${this.signerId}/rpc`, 
      requestBody
    );
    
    if (authSignature) {
      headers['privy-authorization-signature'] = authSignature;
    }
    
    const response = await fetch(`${apiUrl}/wallets/${this.signerId}/rpc`, {
      method: 'POST',
      headers,
      body: requestBody
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Privy transaction failed: ${error}`);
    }

    const result = await response.json();
    const txHash = result.hash || result.data?.hash || result.data?.txHash || result.result;
    
    if (!txHash) {
      throw new Error('Transaction hash not found in Privy response');
    }
    
    return txHash as Hash;
  }
  
  /**
   * Generate authorization signature for backend wallet control
   * Uses Privy's specific payload format
   */
  private generateAuthorizationSignature(method: string, url: string, body: string): string | undefined {
    try {
      const crypto = require('crypto');
      const privateKey = this.extractPrivateKey(this.config.sessionSignerPrivateKey);
      
      // Parse the body as JSON for the payload
      const parsedBody = JSON.parse(body);
      
      // Construct the payload according to Privy's format
      const payload = {
        version: 1,
        method: method.toUpperCase(),
        url: url,
        body: parsedBody,
        headers: {
          'privy-app-id': this.config.privyAppId
        }
      };
      
      // Recursive sorting function for canonical JSON
      function sortObject(obj: any): any {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(sortObject);
        
        const sorted: any = {};
        Object.keys(obj).sort().forEach(key => {
          sorted[key] = sortObject(obj[key]);
        });
        return sorted;
      }
      
      // Sort the payload recursively
      const sortedPayload = sortObject(payload);
      
      // Serialize to canonical JSON
      const payloadString = JSON.stringify(sortedPayload);
      
      // Sign the payload
      const sign = crypto.createSign('SHA256');
      sign.update(payloadString);
      sign.end();
      
      // Parse PEM key (handle escaped newlines)
      const pemKey = privateKey.replace(/\\n/g, '\n');
      
      // Handle both PEM and wallet-auth formats
      let finalKey = pemKey;
      if (pemKey.startsWith('wallet-auth:')) {
        // Convert from base64 DER to PEM
        const base64Key = pemKey.replace('wallet-auth:', '');
        const keyBuffer = Buffer.from(base64Key, 'base64');
        const keyObject = crypto.createPrivateKey({
          key: keyBuffer,
          format: 'der',
          type: 'sec1'
        });
        finalKey = keyObject.export({
          type: 'sec1',
          format: 'pem'
        }) as string;
      }
      
      // Sign in base64 format
      const signature = sign.sign(finalKey, 'base64');
      
      console.log('Authorization signature generated:', {
        signatureLength: signature.length
      });
      
      return signature;
    } catch (error) {
      console.error('Failed to generate authorization signature:', error);
      return undefined;
    }
  }

  /**
   * Create a new Privy agent wallet (static method)
   */
  static async createAgentWallet(
    privyAppId: string,
    privyAppSecret: string,
    chainType: string = 'ethereum'
  ): Promise<{ walletId: string; address: Address }> {
    const response = await fetch('https://api.privy.io/v1/wallets', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${privyAppId}:${privyAppSecret}`).toString('base64')}`,
        'privy-app-id': privyAppId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chain_type: chainType })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create agent wallet: ${error}`);
    }

    const result = await response.json();
    return {
      walletId: result.id,
      address: result.address as Address,
    };
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
   * Add session signer to existing wallet (static method)
   */
  static async addSessionSigner(
    walletId: string,
    privyAppId: string,
    privyAppSecret: string,
    sessionSignerAddress: Address
  ): Promise<{ signerId: string; signerAddress: Address }> {
    const response = await fetch(`https://api.privy.io/v1/wallets/${walletId}/signers`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${privyAppId}:${privyAppSecret}`).toString('base64')}`,
        'privy-app-id': privyAppId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address: sessionSignerAddress,
        type: 'session'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to add session signer: ${error}`);
    }

    const result = await response.json();
    return {
      signerId: result.id,
      signerAddress: result.address as Address,
    };
  }
}