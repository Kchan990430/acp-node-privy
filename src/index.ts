import ACP_ABI from "./acpAbi";
import AcpClient from "./acpClient";
import AcpContractClient, { AcpJobPhases, MemoType, FeeType } from "./acpContractClientV2";
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
  PrivyAuthKeyManager,
  WalletAuthStore,
  type AuthorizationKey,
  type KeyQuorum,
  type WalletAuthConfig
} from "./utils/authKeyManager";

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
  // Per-wallet Auth types
  AuthorizationKey,
  KeyQuorum,
  WalletAuthConfig,
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
  // Per-wallet Auth Management
  PrivyAuthKeyManager,
  WalletAuthStore,
};
