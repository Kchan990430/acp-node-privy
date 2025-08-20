import { Address, createPublicClient, http, Hash } from "viem";
import { createSmartAccountClient, ENTRYPOINT_ADDRESS_V06, ENTRYPOINT_ADDRESS_V07 } from "permissionless";
import { toKernelSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { entryPoint07Address } from "viem/account-abstraction";
import { PrivyClient } from "@privy-io/server-auth";
// @ts-ignore - TypeScript may not resolve this correctly
import { createViemAccount } from "@privy-io/server-auth/viem";

export interface GasSponsorshipConfig {
  paymasterUrl: string;
  bundlerUrl: string;
  privyAppId: string;
  privyAppSecret: string;
  walletId: string;
  walletAddress: Address;
  sessionSignerPrivateKey: string;
  chain: any;
  publicClient: any;
}

export class GasSponsorshipManager {
  private smartAccountClient: any;
  private smartAccountAddress?: Address;
  private config: GasSponsorshipConfig;
  private privy: PrivyClient;
  private pendingNonce: number = 0;
  private nonceQueue: Promise<any> = Promise.resolve();

  constructor(config: GasSponsorshipConfig) {
    this.config = config;
    this.privy = new PrivyClient(config.privyAppId, config.privyAppSecret);
  }

  async initialize() {
    try {
      console.log('🚀 Initializing gas sponsorship with Privy smart wallet...');
      
      // Update authorization key for signing
      await this.privy.walletApi.updateAuthorizationKey(this.config.sessionSignerPrivateKey);
      
      // Create viem account from Privy wallet
      const viemAccount = await createViemAccount({
        walletId: this.config.walletId,
        address: this.config.walletAddress,
        privy: this.privy
      });
      
      console.log('✅ Created viem account:', viemAccount.address);
      
      // Create a Kernel smart account (following Privy docs)
      const kernelAccount = await toKernelSmartAccount({
        client: this.config.publicClient,
        entryPoint: {
          address: entryPoint07Address,
          version: '0.7'
        },
        owners: [viemAccount],
      });
      
      console.log('✅ Created Kernel smart account with address:', kernelAccount.address);
      this.smartAccountAddress = kernelAccount.address;
      
      // Check smart account balance
      const balance = await this.config.publicClient.getBalance({
        address: kernelAccount.address
      });
      
      console.log(`💰 Smart account balance: ${balance} wei (${Number(balance) / 1e18} ETH)`);
      
      if (balance === 0n) {
        console.warn('⚠️ Smart account has no funds! Please send ETH to:', kernelAccount.address);
        console.warn('⚠️ Without funds or a working paymaster, transactions will fail');
      }
      
      // Create bundler client  
      const pimlicoBundlerClient = createPimlicoClient({
        transport: http(this.config.bundlerUrl),
        entryPoint: {
          address: entryPoint07Address,
          version: '0.7'
        }
      });
      
      // Try to create paymaster client for sponsorship
      let paymasterClient;
      try {
        paymasterClient = createPimlicoClient({
          transport: http(this.config.paymasterUrl),
          entryPoint: {
            address: entryPoint07Address,
            version: '0.7'
          }
        });
        console.log('✅ Paymaster client created');
      } catch (error) {
        console.warn('⚠️ Paymaster client creation failed, transactions will require ETH in smart account');
      }
      
      // Create smart account client with optional paymaster
      this.smartAccountClient = createSmartAccountClient({
        account: kernelAccount,
        chain: this.config.chain,
        bundlerTransport: http(this.config.bundlerUrl),
        ...(paymasterClient && {
          paymaster: paymasterClient,
        }),
        userOperation: {
          estimateFeesPerGas: async () => {
            try {
              const fees = await pimlicoBundlerClient.getUserOperationGasPrice();
              return fees.fast || fees;
            } catch (error) {
              console.warn('Failed to get gas price from Pimlico, using defaults');
              return {
                maxFeePerGas: BigInt(1500000000), // 1.5 gwei
                maxPriorityFeePerGas: BigInt(1500000000), // 1.5 gwei
              };
            }
          }
        }
      });
      
      console.log('✅ Gas sponsorship initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize gas sponsorship:', error);
      return false;
    }
  }

  async sendSponsoredTransaction(params: {
    to: Address;
    data: `0x${string}`;
    value?: bigint;
  }): Promise<Hash | null> {
    if (!this.smartAccountClient) {
      console.log('Smart account client not initialized');
      return null;
    }

    // Queue transactions to handle nonce properly
    return new Promise((resolve) => {
      this.nonceQueue = this.nonceQueue.then(async () => {
        try {
          console.log('📤 Sending gas-sponsored transaction...');
          
          // Add a small delay between transactions to avoid nonce conflicts
          if (this.pendingNonce > 0) {
            await new Promise(r => setTimeout(r, 500));
          }
          
          const hash = await this.smartAccountClient.sendTransaction({
            to: params.to,
            data: params.data,
            value: params.value || 0n
          });
          
          console.log('✅ Gas-sponsored transaction sent:', hash);
          this.pendingNonce++;
          resolve(hash);
        } catch (error: any) {
          // Check if it's a nonce error and retry with delay
          if (error.message?.includes('AA25') || error.message?.includes('nonce')) {
            console.log('⚠️ Nonce conflict detected, retrying with delay...');
            await new Promise(r => setTimeout(r, 2000));
            
            try {
              const hash = await this.smartAccountClient.sendTransaction({
                to: params.to,
                data: params.data,
                value: params.value || 0n
              });
              
              console.log('✅ Retry successful:', hash);
              this.pendingNonce++;
              resolve(hash);
            } catch (retryError) {
              console.error('❌ Gas sponsorship failed after retry:', retryError);
              resolve(null);
            }
          } else {
            console.error('❌ Gas sponsorship failed:', error);
            resolve(null);
          }
        }
      });
    });
  }

  isInitialized(): boolean {
    return !!this.smartAccountClient;
  }

  getSmartAccountAddress(): Address | undefined {
    return this.smartAccountAddress;
  }
  
  async getSmartAccountBalance(): Promise<bigint | null> {
    if (!this.smartAccountAddress) {
      return null;
    }
    
    try {
      const balance = await this.config.publicClient.getBalance({
        address: this.smartAccountAddress
      });
      return balance;
    } catch (error) {
      console.error('Failed to get smart account balance:', error);
      return null;
    }
  }
}