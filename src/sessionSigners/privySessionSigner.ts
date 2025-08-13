import { Address, Hash } from "viem";
import { SessionSigner } from "../interfaces";

export interface PrivySessionSignerConfig {
  walletId: string;
  walletAddress: Address;
  privyAppId: string;
  privyAppSecret: string;
  sessionSignerPrivateKey: string; // Private key for backend control (PEM or wallet-auth:BASE64 format)
  keyQuorumId?: string; // Optional: Key quorum ID if using key quorum approach
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
  private privateKey?: string; // Store private key if updateAuthorizationKey not available
  
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
      
      // Extract private key first
      const privateKey = this.extractPrivateKey(this.config.sessionSignerPrivateKey);
      
      // Initialize PrivyClient with walletApi configuration
      this.privyClient = new PrivyClient(
        this.config.privyAppId,
        this.config.privyAppSecret,
        {
          walletApi: {
            // Pass the authorization private key during initialization
            authorizationPrivateKey: privateKey || undefined
          }
        }
      );
      
      console.log('✅ PrivyClient initialized with configuration');
      console.log('WalletApi available:', !!this.privyClient.walletApi);
      
      // Log available properties on privyClient
      if (this.privyClient.walletApi) {
        console.log('✅ WalletApi is available');
        console.log('WalletApi.ethereum available:', !!this.privyClient.walletApi.ethereum);
        console.log('WalletApi.solana available:', !!this.privyClient.walletApi.solana);
        
        // Check if updateAuthorizationKey exists
        if (typeof this.privyClient.walletApi.updateAuthorizationKey === 'function') {
          console.log('✅ updateAuthorizationKey method is available');
        }
      } else {
        console.log('⚠️ WalletApi not initialized');
        this.privateKey = privateKey; // Store for fallback
      }
    } catch (error) {
      console.error('Failed to initialize PrivyClient:', error);
      throw error; // Don't continue if initialization fails
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
  async signTransaction(_tx: any): Promise<string> {
    // For now, we'll throw an error as Privy doesn't expose signing without sending
    // The ACP SDK should use sendTransaction directly
    throw new Error('PrivySessionSigner does not support signing without sending. Use sendTransaction instead.');
  }

  /**
   * Send transaction using PrivyClient with session signer
   * Following Privy's example with updateAuthorizationKey and sendTransaction
   */
  async sendTransaction(tx: any): Promise<Hash> {
    // Ensure PrivyClient is initialized
    if (!this.privyClient) {
      await this.initPrivyClient();
    }
    
    try {
      console.log('Sending transaction via Privy SDK with session signer:', {
        walletId: this.signerId,
        to: tx.to,
        value: tx.value?.toString(),
        chainId: this.chainId
      });

      // Check if walletApi and ethereum are available
      if (!this.privyClient.walletApi) {
        throw new Error('WalletApi not available on PrivyClient');
      }
      
      if (!this.privyClient.walletApi.ethereum) {
        throw new Error('Ethereum RPC API not available on WalletApi');
      }

      // Use the correct walletApi.ethereum.sendTransaction method
      // Convert value to hex string to avoid BigInt serialization issues
      const valueHex = tx.value ? `0x${BigInt(tx.value).toString(16)}` : '0x0';
      
      const result = await this.privyClient.walletApi.ethereum.sendTransaction({
        walletId: this.signerId,
        transaction: {
          to: tx.to,
          value: valueHex, // Use hex string format
          ...(tx.data && tx.data !== '0x' ? { data: tx.data } : {})
        },
        caip2: this.caip2 as `eip155:${string}`
      });

      // Extract transaction hash from result
      const txHash = result.hash;
      
      console.log('Transaction sent successfully via session signer:', txHash);
      return txHash as Hash;
      
    } catch (error: any) {
      console.error('Privy SDK transaction failed:', error);
      // Fallback to direct API if SDK fails
      console.log('Falling back to direct API...');
      return this.sendTransactionDirectAPI(tx);
    }
  }
  
  /**
   * Direct API method using Privy's wallet RPC endpoint with session signer
   */
  private async sendTransactionDirectAPI(tx: any): Promise<Hash> {
    const apiUrl = 'https://api.privy.io/v1';
    
    // Construct the RPC request body according to Privy's format
    // Based on the documentation, eth_sendTransaction expects this format
    const requestBody = {
      method: 'eth_sendTransaction',
      caip2: this.caip2,
      chain_type: 'ethereum',
      wallet_id: this.signerId,
      params: {
        transaction: {
          to: tx.to,
          value: tx.value ? `0x${(BigInt(tx.value)).toString(16)}` : '0x0',
          ...(tx.data && tx.data !== '0x' ? { data: tx.data } : {})
        }
      }
    };
    
    // Try different endpoint formats that might work with current Privy API
    const url = `${apiUrl}/rpc`;
    const method = 'POST';
    
    console.log('Sending transaction via Privy RPC:', {
      walletId: this.signerId,
      from: this.address,
      to: tx.to,
      value: tx.value?.toString()
    });
    
    // Generate authorization signature for the request
    const authSignature = this.generateAuthorizationSignature(
      method,
      url,
      JSON.stringify(requestBody)
    );
    
    // Try different authentication formats based on Privy's current API
    const headers: any = {
      'Content-Type': 'application/json',
      'privy-app-id': this.config.privyAppId,
      'privy-app-secret': this.config.privyAppSecret,
    };
    
    // Add authorization signature if we have a key quorum configured
    if (authSignature) {
      headers['privy-authorization-signature'] = authSignature;
      console.log('Authorization signature added for session signer');
    }
    
    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      console.error('Privy RPC error:', responseText);
      throw new Error(`Privy transaction failed: ${responseText}`);
    }

    try {
      const result = JSON.parse(responseText);
      const txHash = result.result || result.hash || result.data?.hash || result.data?.txHash;
      
      if (!txHash) {
        console.error('Unexpected response format:', result);
        throw new Error('Transaction hash not found in Privy response');
      }
      
      console.log('Transaction sent successfully:', txHash);
      return txHash as Hash;
    } catch (error) {
      console.error('Failed to parse response:', responseText);
      throw new Error('Invalid response from Privy API');
    }
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
   * Create a new Privy agent wallet with optional key quorum (static method)
   */
  static async createAgentWallet(
    privyAppId: string,
    privyAppSecret: string,
    chainType: 'ethereum' | 'solana' = 'ethereum',
    keyQuorumId?: string,
    userId?: string
  ): Promise<{ walletId: string; address: Address }> {
    try {
      // Dynamic import to use PrivyClient
      const { PrivyClient } = await import('@privy-io/server-auth');
      const privy = new PrivyClient(privyAppId, privyAppSecret);
      
      // Create wallet first, optionally linked to user
      const walletConfig: any = {
        chainType: chainType as any
      };
      
      // Link to user if userId provided
      if (userId) {
        walletConfig.linkedTo = userId;
        walletConfig.createAdditional = true; // Allow creating additional wallets for the user
        console.log('Creating additional wallet linked to user:', userId);
      }
      
      const wallet = await privy.walletApi.createWallet(walletConfig);
      console.log('Created wallet:', wallet.id, userId ? `(linked to user ${userId})` : '(no user)');
      
      // Then update it to add the key quorum if provided (following Privy's example)
      if (keyQuorumId) {
        console.log('Updating wallet to add key quorum:', keyQuorumId);
        await privy.walletApi.updateWallet({
          id: wallet.id,
          additionalSigners: [{
            signerId: keyQuorumId
          }]
        });
        console.log('Key quorum added to wallet');
      }
      
      return {
        walletId: wallet.id,
        address: wallet.address as Address,
      };
    } catch (error: any) {
      // Fallback to direct API call
      const response = await fetch('https://api.privy.io/v1/wallets', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${privyAppId}:${privyAppSecret}`).toString('base64')}`,
          'privy-app-id': privyAppId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          chain_type: chainType
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create agent wallet: ${error}`);
      }

      const result = await response.json();
      
      // If key quorum is provided, update the wallet
      if (keyQuorumId) {
        await PrivySessionSigner.updateWallet(
          result.id,
          keyQuorumId,
          privyAppId,
          privyAppSecret
        );
      }
      
      return {
        walletId: result.id,
        address: result.address as Address,
      };
    }
  }

  /**
   * Update wallet to add key quorum as additional signer (static method)
   * Uses PATCH endpoint per Privy's new approach
   */
  static async updateWallet(
    walletId: string,
    keyQuorumId: string,
    privyAppId: string,
    privyAppSecret: string
  ): Promise<void> {
    // Use direct API call for PATCH operation
    const response = await fetch(`https://api.privy.io/v1/wallets/${walletId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${privyAppId}:${privyAppSecret}`).toString('base64')}`,
        'privy-app-id': privyAppId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        additional_signers: [keyQuorumId]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update wallet with key quorum: ${error}`);
    }
    
    console.log(`✅ Wallet ${walletId} updated with key quorum ${keyQuorumId}`);
  }

  /**
   * Create a key quorum for authorization (static method)
   * Key quorums allow backend authorization without user interaction
   */
  static async createKeyQuorum(
    publicKey: string,
    privyAppId: string,
    privyAppSecret: string,
    threshold: number = 1
  ): Promise<string> {
    const response = await fetch('https://api.privy.io/v1/key_quorums', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${privyAppId}:${privyAppSecret}`).toString('base64')}`,
        'privy-app-id': privyAppId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        public_keys: [publicKey],
        threshold
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create key quorum: ${error}`);
    }

    const result = await response.json();
    return result.id;
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