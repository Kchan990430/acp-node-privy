import { 
  Address, 
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  fromHex,
  http,
  Hash
} from "viem";
import { publicActionsL2 } from "viem/op-stack";
import { AcpContractConfig, baseAcpConfig } from "./configs";
import ACP_ABI from "./acpAbi";
import { SessionSigner } from "./interfaces";
import { GasSponsorshipManager } from "./gasSponsorship";

export enum MemoType {
  MESSAGE,
  CONTEXT_URL,
  IMAGE_URL,
  VOICE_URL,
  OBJECT_URL,
  TXHASH,
  PAYABLE_REQUEST,
  PAYABLE_TRANSFER,
  PAYABLE_FEE,
  PAYABLE_FEE_REQUEST,
}

export enum AcpJobPhases {
  REQUEST = 0,
  NEGOTIATION = 1,
  TRANSACTION = 2,
  EVALUATION = 3,
  COMPLETED = 4,
  REJECTED = 5,
  EXPIRED = 6,
}

export enum FeeType {
  NO_FEE,
  IMMEDIATE_FEE,
  DEFERRED_FEE,
}

class AcpContractClient {
  private MAX_RETRIES = 3;

  private publicClient: any;
  private sessionSigner: SessionSigner;
  private chain;
  private contractAddress: Address;
  private virtualsTokenAddress: Address;
  private gasSponsorshipManager?: GasSponsorshipManager;

  constructor(
    sessionSigner: SessionSigner,
    public config: AcpContractConfig = baseAcpConfig,
    public customRpcUrl?: string
  ) {
    this.sessionSigner = sessionSigner;
    this.chain = config.chain;
    this.contractAddress = config.contractAddress;
    this.virtualsTokenAddress = config.virtualsTokenAddress;

    // Create public client for reading blockchain data
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: this.customRpcUrl ? http(this.customRpcUrl) : http(),
    }).extend(publicActionsL2());
  }

  static async build(
    sessionSigner: SessionSigner,
    customRpcUrl?: string,
    config: AcpContractConfig = baseAcpConfig
  ) {
    const acpContractClient = new AcpContractClient(
      sessionSigner,
      config,
      customRpcUrl
    );

    await acpContractClient.init();
    return acpContractClient;
  }

  async init() {
    console.log('Initializing AcpContractClient...');
    
    // Try to setup gas sponsorship if configuration is available
    if (this.config.paymasterUrl && this.config.bundlerUrl) {
      await this.setupGasSponsorship();
    }
    
    console.log('✅ AcpContractClient initialized');
  }

  private async setupGasSponsorship() {
    try {
      // Check if sessionSigner has Privy configuration
      const signerConfig = (this.sessionSigner as any).config;
      if (!signerConfig?.privyAppId || !signerConfig?.privyAppSecret || !signerConfig?.walletId) {
        console.log('Gas sponsorship requires PrivySessionSigner with credentials');
        return;
      }

      this.gasSponsorshipManager = new GasSponsorshipManager({
        paymasterUrl: this.config.paymasterUrl!,
        bundlerUrl: this.config.bundlerUrl!,
        privyAppId: signerConfig.privyAppId,
        privyAppSecret: signerConfig.privyAppSecret,
        walletId: signerConfig.walletId,
        walletAddress: signerConfig.walletAddress,
        sessionSignerPrivateKey: signerConfig.sessionSignerPrivateKey,
        chain: this.chain,
        publicClient: this.publicClient
      });

      const initialized = await this.gasSponsorshipManager.initialize();
      if (!initialized) {
        this.gasSponsorshipManager = undefined;
      }
    } catch (error) {
      console.warn('Failed to setup gas sponsorship:', error);
      this.gasSponsorshipManager = undefined;
    }
  }

  get walletAddress() {
    return this.sessionSigner.address;
  }

  get smartAccountAddress() {
    return this.gasSponsorshipManager?.getSmartAccountAddress();
  }
  
  async getSmartAccountBalance() {
    return this.gasSponsorshipManager?.getSmartAccountBalance() || null;
  }

  private async calculateGasFees() {
    const { maxFeePerGas, maxPriorityFeePerGas } =
      await this.publicClient.estimateFeesPerGas();

    let finalMaxFeePerGas = maxFeePerGas;
    let priorityFeeMultiplier = Number(this.config.priorityFeeMultiplier) || 2;

    const overrideMaxFeePerGas = this.config.maxFeePerGas || maxFeePerGas;
    const overrideMaxPriorityFeePerGas =
      this.config.maxPriorityFeePerGas || maxPriorityFeePerGas;

    finalMaxFeePerGas =
      BigInt(overrideMaxFeePerGas) +
      BigInt(overrideMaxPriorityFeePerGas) *
        BigInt(Math.max(0, priorityFeeMultiplier - 1));

    return finalMaxFeePerGas;
  }

  private async sendTransaction(
    to: Address,
    data: `0x${string}`,
    value?: bigint,
    forceEOA: boolean = false // Add flag to force using EOA instead of smart account
  ): Promise<Hash> {
    // Try gas-sponsored transaction first if available and not forced to use EOA
    if (!forceEOA && this.gasSponsorshipManager?.isInitialized()) {
      const sponsoredHash = await this.gasSponsorshipManager.sendSponsoredTransaction({
        to,
        data,
        value
      });
      
      if (sponsoredHash) {
        // Wait for receipt to confirm success
        const receipt = await this.publicClient.waitForTransactionReceipt({
          hash: sponsoredHash,
        });
        
        if (receipt.status === 'success') {
          return sponsoredHash;
        }
      }
      // If sponsored transaction failed, fall through to regular transaction
      console.log('Falling back to regular transaction...');
    }

    // Regular transaction flow
    const maxFeePerGas = await this.calculateGasFees();
    const gas = await this.publicClient.estimateGas({
      account: this.sessionSigner.address,
      to,
      data,
      value,
      maxFeePerGas,
    });

    const hash = await this.sessionSigner.sendTransaction({
      to,
      data,
      value,
      gas,
      maxFeePerGas,
      chain: this.chain,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
    });

    if (receipt.status === 'success') {
      return hash;
    } else {
      throw new Error('Transaction failed');
    }
  }


  private async getJobIdFromTx(hash: Hash): Promise<number> {
    const receipt = await this.publicClient.getTransactionReceipt({ hash });

    const contractLog = receipt.logs.find(
      (log: any) => log.address.toLowerCase() === this.contractAddress.toLowerCase()
    );

    if (!contractLog) {
      throw new Error("Failed to get contract logs");
    }

    return fromHex(contractLog.data, "number");
  }

  async createJob(
    providerAddress: string,
    evaluatorAddress: string,
    expireAt: Date
  ): Promise<{ txHash: string; jobId: number }> {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "createJob",
        args: [
          providerAddress,
          evaluatorAddress,
          Math.floor(expireAt.getTime() / 1000),
        ],
      });
      
      // Use smart account if available for gas sponsorship
      const hash = await this.sendTransaction(this.contractAddress, data);
      const jobId = await this.getJobIdFromTx(hash);

      return { txHash: hash, jobId };
    } catch (error: any) {
      throw new Error(`Failed to create job: ${error.message || error}`);
    }
  }

  async approveAllowance(priceInWei: bigint) {
    try {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [this.contractAddress, priceInWei],
      });

      return await this.sendTransaction(this.virtualsTokenAddress, data);
    } catch (error) {
      throw new Error("Failed to approve allowance");
    }
  }

  async createPayableFeeMemo(
    jobId: number,
    content: string,
    amount: bigint,
    memoType: MemoType.PAYABLE_FEE | MemoType.PAYABLE_FEE_REQUEST,
    nextPhase: AcpJobPhases
  ) {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "createPayableFeeMemo",
        args: [jobId, content, amount, memoType, nextPhase],
      });

      return await this.sendTransaction(this.contractAddress, data);
    } catch (error) {
      throw new Error("Failed to create payable fee memo");
    }
  }

  async createPayableMemo(
    jobId: number,
    content: string,
    amount: bigint,
    recipient: Address,
    feeAmount: bigint,
    feeType: FeeType,
    nextPhase: AcpJobPhases,
    type: MemoType.PAYABLE_REQUEST | MemoType.PAYABLE_TRANSFER,
    expiredAt?: Date,
    token: Address = this.config.virtualsTokenAddress
  ) {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "createPayableMemo",
        args: [
          jobId,
          content,
          token,
          amount,
          recipient,
          feeAmount,
          feeType,
          type,
          nextPhase,
          expiredAt ? Math.floor(expiredAt.getTime() / 1000) : 0,
        ],
      });

      return await this.sendTransaction(this.contractAddress, data);
    } catch (error) {
      throw new Error("Failed to create payable memo");
    }
  }

  async createMemo(
    jobId: number,
    content: string,
    type: MemoType,
    isSecured: boolean,
    nextPhase: AcpJobPhases
  ): Promise<Address> {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "createMemo",
        args: [jobId, content, type, isSecured, nextPhase],
      });

      // Use smart account if available for gas sponsorship
      return await this.sendTransaction(this.contractAddress, data);
    } catch (error) {
      throw new Error("Failed to create memo");
    }
  }

  async getMemoId(hash: Hash): Promise<number> {
    const receipt = await this.publicClient.getTransactionReceipt({ hash });

    const contractLog = receipt.logs.find(
      (log: any) => log.address.toLowerCase() === this.contractAddress.toLowerCase()
    );

    if (!contractLog) {
      throw new Error("Failed to get contract logs");
    }

    const decoded = decodeEventLog({
      abi: ACP_ABI,
      data: contractLog.data,
      topics: contractLog.topics,
    });

    if (!decoded.args) {
      throw new Error("Failed to decode event logs");
    }

    return parseInt((decoded.args as any).memoId);
  }

  async signMemo(memoId: number, isApproved: boolean, reason?: string) {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "signMemo",
        args: [memoId, isApproved, reason],
      });

      return await this.sendTransaction(this.contractAddress, data);
    } catch (error) {
      throw new Error("Failed to sign memo");
    }
  }

  async setBudget(jobId: number, budget: bigint) {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "setBudget",
        args: [jobId, budget],
      });

      return await this.sendTransaction(this.contractAddress, data);
    } catch (error) {
      throw new Error("Failed to set budget");
    }
  }
}

export default AcpContractClient;