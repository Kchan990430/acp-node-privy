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
    // No initialization needed for SessionSigner
    console.log('✅ AcpContractClient initialized with SessionSigner');
  }

  get walletAddress() {
    return this.sessionSigner.address;
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
    value?: bigint
  ): Promise<Hash> {
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

  // Batch operations (useful with session signers)
  async sendBatchTransactions(
    transactions: Array<{
      to: Address;
      data: `0x${string}`;
      value?: bigint;
    }>
  ): Promise<Hash[]> {
    const hashes: Hash[] = [];
    
    for (const tx of transactions) {
      try {
        const hash = await this.sendTransaction(tx.to, tx.data, tx.value);
        hashes.push(hash);
      } catch (error) {
        throw new Error(`Batch failed at transaction ${hashes.length + 1}: ${error}`);
      }
    }
    
    return hashes;
  }

  // Create multiple jobs in batch
  async createMultipleJobs(
    jobs: Array<{
      providerAddress: string;
      evaluatorAddress: string;
      expireAt: Date;
    }>
  ): Promise<Array<{txHash: string; jobId: number}>> {
    const transactions = jobs.map(job => ({
      to: this.contractAddress as Address,
      data: encodeFunctionData({
        abi: ACP_ABI,
        functionName: "createJob",
        args: [
          job.providerAddress,
          job.evaluatorAddress,
          Math.floor(job.expireAt.getTime() / 1000),
        ],
      }) as `0x${string}`
    }));
    
    const hashes = await this.sendBatchTransactions(transactions);
    
    const results = await Promise.all(
      hashes.map(async (hash) => {
        const jobId = await this.getJobIdFromTx(hash);
        return { txHash: hash, jobId };
      })
    );
    
    return results;
  }

  // Create multiple memos in batch
  async createMultipleMemos(
    memos: Array<{
      jobId: number;
      content: string;
      type: MemoType;
      isSecured: boolean;
      nextPhase: AcpJobPhases;
    }>
  ): Promise<Hash[]> {
    const transactions = memos.map(memo => ({
      to: this.contractAddress as Address,
      data: encodeFunctionData({
        abi: ACP_ABI,
        functionName: "createMemo",
        args: [memo.jobId, memo.content, memo.type, memo.isSecured, memo.nextPhase],
      }) as `0x${string}`
    }));

    return await this.sendBatchTransactions(transactions);
  }
}

export default AcpContractClient;