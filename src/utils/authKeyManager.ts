import * as crypto from 'crypto';
import { promisify } from 'util';

const generateKeyPair = promisify(crypto.generateKeyPair);

export interface AuthorizationKey {
  privateKey: string;
  publicKey: string;
  privateKeyBase64: string;
}

export interface KeyQuorum {
  id: string;
  name: string;
  authorizationKeyIds: string[];
  threshold: number;
}

export interface WalletAuthConfig {
  walletId: string;
  walletAddress: string;
  keyQuorumId: string;
  authKeyId: string;
  privateKey: string;
  privateKeyBase64: string;
  publicKey: string;
  createdAt: Date;
}

/**
 * Manages per-wallet Authorization Keys for Privy wallets
 * Each wallet gets its own unique P-256 key pair - never reused across wallets
 */
export class PrivyAuthKeyManager {
  private privyAppId: string;
  private privyAppSecret: string;
  private apiUrl = 'https://auth.privy.io/api/v1';

  constructor(appId: string, appSecret: string) {
    this.privyAppId = appId;
    this.privyAppSecret = appSecret;
  }

  /**
   * Generate a new P-256 key pair for a specific wallet
   * Each wallet gets its own unique key - never shared
   */
  async generateWalletAuthKey(): Promise<AuthorizationKey> {
    const { privateKey, publicKey } = await generateKeyPair('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'sec1',
        format: 'pem'
      }
    });

    // Convert private key to base64 DER format for storage
    const privateKeyDer = crypto.createPrivateKey(privateKey as string).export({
      format: 'der',
      type: 'sec1'
    });
    const privateKeyBase64 = `wallet-auth:${privateKeyDer.toString('base64')}`;

    return {
      privateKey: privateKey as string,
      publicKey: publicKey as string,
      privateKeyBase64
    };
  }

  /**
   * Create an Authorization Key in Privy
   */
  async createAuthorizationKey(
    publicKey: string,
    walletAddress: string
  ): Promise<string> {
    const basicAuth = this.getBasicAuth();
    
    const response = await fetch(`${this.apiUrl}/authorization_keys`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        'privy-app-id': this.privyAppId
      },
      body: JSON.stringify({
        public_key: publicKey,
        name: `wallet-${walletAddress.slice(0, 8)}-${Date.now()}`
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create authorization key: ${error}`);
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Create a Key Quorum for a specific wallet
   */
  async createKeyQuorum(
    publicKey: string,
    walletAddress: string
  ): Promise<string> {
    const basicAuth = this.getBasicAuth();
    
    // Create key quorum directly with the public key
    // Note: Privy API doesn't accept threshold field, it defaults to 1
    const payload = {
      public_keys: [publicKey]
    };
    
    console.log('Creating key quorum with public key...');
    
    const response = await fetch(`${this.apiUrl}/key_quorums`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        'privy-app-id': this.privyAppId
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create key quorum: ${error}`);
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Add Key Quorum as Session Signer to wallet
   */
  async addSessionSignerToWallet(
    walletId: string,
    keyQuorumId: string
  ): Promise<void> {
    const basicAuth = this.getBasicAuth();
    
    const response = await fetch(`${this.apiUrl}/wallets/${walletId}/signers`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        'privy-app-id': this.privyAppId
      },
      body: JSON.stringify({
        signer_id: keyQuorumId,
        type: 'key_quorum'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to add session signer: ${error}`);
    }
  }

  /**
   * Remove Session Signer from wallet (revoke)
   */
  async removeSessionSignerFromWallet(
    walletId: string,
    keyQuorumId: string
  ): Promise<void> {
    const basicAuth = this.getBasicAuth();
    
    const response = await fetch(`${this.apiUrl}/wallets/${walletId}/signers/${keyQuorumId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'privy-app-id': this.privyAppId
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to remove session signer: ${error}`);
    }
  }

  /**
   * Delete a Key Quorum (requires authorization signature)
   */
  async deleteKeyQuorum(
    keyQuorumId: string,
    privateKey: string
  ): Promise<void> {
    const basicAuth = this.getBasicAuth();
    const url = `${this.apiUrl}/key_quorums/${keyQuorumId}`;
    
    // Generate authorization signature for DELETE operation
    const signature = this.generateAuthorizationSignature(
      privateKey,
      'DELETE',
      url,
      {}
    );
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'privy-app-id': this.privyAppId,
        'privy-authorization-signature': signature
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete key quorum: ${error}`);
    }
  }

  /**
   * Complete flow: Create wallet with unique authorization key
   */
  async setupWalletWithAuth(
    walletId: string,
    walletAddress: string
  ): Promise<WalletAuthConfig> {
    // Step 1: Generate unique key pair for this wallet
    console.log(`Generating unique auth key for wallet ${walletAddress}...`);
    const authKey = await this.generateWalletAuthKey();

    // Step 2: Create Key Quorum directly with the public key (skip authorization key creation)
    console.log('Creating key quorum with public key...');
    const keyQuorumId = await this.createKeyQuorum(authKey.publicKey, walletAddress);

    // Step 3: Add as Session Signer to wallet
    console.log('Adding key quorum as session signer to wallet...');
    await this.addSessionSignerToWallet(walletId, keyQuorumId);

    const config: WalletAuthConfig = {
      walletId,
      walletAddress,
      keyQuorumId,
      authKeyId: '', // No longer using authorization key API
      privateKey: authKey.privateKey,
      privateKeyBase64: authKey.privateKeyBase64,
      publicKey: authKey.publicKey,
      createdAt: new Date()
    };

    console.log(`✅ Wallet ${walletAddress} setup with unique auth key complete`);
    return config;
  }

  /**
   * Rotate Session Signer: Create new key/quorum, add it, remove old one
   */
  async rotateSessionSigner(
    walletId: string,
    walletAddress: string,
    oldKeyQuorumId: string,
    oldPrivateKey: string
  ): Promise<WalletAuthConfig> {
    console.log(`Rotating session signer for wallet ${walletAddress}...`);
    
    // Step 1: Setup new auth key and quorum
    const newConfig = await this.setupWalletWithAuth(walletId, walletAddress);

    // Step 2: Remove old session signer from wallet
    console.log('Removing old session signer...');
    await this.removeSessionSignerFromWallet(walletId, oldKeyQuorumId);

    // Step 3: Delete old key quorum (cleanup)
    console.log('Deleting old key quorum...');
    try {
      await this.deleteKeyQuorum(oldKeyQuorumId, oldPrivateKey);
    } catch (error) {
      console.warn('Failed to delete old key quorum:', error);
      // Continue anyway - main goal is to rotate the signer
    }

    console.log(`✅ Session signer rotated successfully for wallet ${walletAddress}`);
    return newConfig;
  }

  /**
   * Revoke Session Signer: Remove from wallet and delete quorum
   */
  async revokeSessionSigner(
    walletId: string,
    keyQuorumId: string,
    privateKey: string
  ): Promise<void> {
    console.log(`Revoking session signer for wallet ${walletId}...`);
    
    // Step 1: Remove from wallet
    await this.removeSessionSignerFromWallet(walletId, keyQuorumId);

    // Step 2: Delete key quorum
    try {
      await this.deleteKeyQuorum(keyQuorumId, privateKey);
    } catch (error) {
      console.warn('Failed to delete key quorum:', error);
    }

    console.log(`✅ Session signer revoked for wallet ${walletId}`);
  }

  private getBasicAuth(): string {
    return Buffer.from(`${this.privyAppId}:${this.privyAppSecret}`).toString('base64');
  }

  private generateAuthorizationSignature(
    privateKey: string,
    method: string,
    url: string,
    body: any
  ): string {
    const payload = {
      version: 1,
      method: method.toUpperCase(),
      url,
      body,
      headers: {
        'privy-app-id': this.privyAppId
      }
    };

    // Sort object keys recursively
    function sortObject(obj: any): any {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(sortObject);
      
      const sorted: any = {};
      Object.keys(obj).sort().forEach(key => {
        sorted[key] = sortObject(obj[key]);
      });
      return sorted;
    }

    const sortedPayload = sortObject(payload);
    const payloadString = JSON.stringify(sortedPayload);

    // Sign the payload
    const sign = crypto.createSign('SHA256');
    sign.update(payloadString);
    sign.end();

    // Handle PEM format
    const pemKey = privateKey.replace(/\\n/g, '\n');
    const signature = sign.sign(pemKey, 'base64');

    return signature;
  }
}

/**
 * In-memory store for wallet auth configs (use database in production)
 */
export class WalletAuthStore {
  private static store = new Map<string, WalletAuthConfig>();

  static save(walletId: string, config: WalletAuthConfig): void {
    this.store.set(walletId, config);
  }

  static get(walletId: string): WalletAuthConfig | undefined {
    return this.store.get(walletId);
  }

  static getByAddress(address: string): WalletAuthConfig | undefined {
    for (const config of this.store.values()) {
      if (config.walletAddress === address) {
        return config;
      }
    }
    return undefined;
  }

  static delete(walletId: string): void {
    this.store.delete(walletId);
  }

  static getAll(): WalletAuthConfig[] {
    return Array.from(this.store.values());
  }
}