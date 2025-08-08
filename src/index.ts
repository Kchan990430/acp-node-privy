import ACP_ABI from "./acpAbi";
import AcpClient from "./acpClient";
import AcpContractClient, { AcpJobPhases, MemoType, FeeType } from "./acpContractClient";
import AcpJob from "./acpJob";
import AcpMemo from "./acpMemo";
import {
  AcpAgentSort,
  PayloadType,
  FundResponsePayload,
  AcpGraduationStatus,
  AcpOnlineStatus,
  IDeliverable,
  OpenPositionPayload,
  ClosePositionPayload,
  RequestClosePositionPayload,
  WalletProvider,
  SessionSigner,
  PrivyChainType,
} from "./interfaces";
import {
  AcpContractConfig,
  baseAcpConfig,
  baseSepoliaAcpConfig,
} from "./configs";
import { PrivySessionSigner } from "./sessionSigners/privySessionSigner";
import {
  transferFunds,
  getBalance,
  approveTokenSpending,
  transferAllBalance
} from "./utils/fundTransfer";

export default AcpClient;

// Export types
export type {
  IDeliverable,
  AcpContractConfig,
  AcpAgentSort,
  PayloadType,
  FundResponsePayload,
  AcpGraduationStatus,
  AcpOnlineStatus,
  OpenPositionPayload,
  ClosePositionPayload,
  RequestClosePositionPayload,
  // Core interfaces
  WalletProvider,
  SessionSigner,
  PrivyChainType,
};

// Export values
export {
  AcpContractClient,
  baseSepoliaAcpConfig,
  baseAcpConfig,
  AcpJobPhases,
  MemoType,
  FeeType,
  AcpJob,
  AcpMemo,
  ACP_ABI,
  // Session Signers
  PrivySessionSigner,
  // Utilities
  transferFunds,
  getBalance,
  approveTokenSpending,
  transferAllBalance,
};
