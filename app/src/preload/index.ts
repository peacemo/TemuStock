import { contextBridge, ipcRenderer } from 'electron';

import type {
  ApiResult,
  BuyRequest,
  CreateMemberRequest,
  DividendRequest,
  ExitMemberRequest,
  HistoricalSnapshot,
  LedgerHistoryQuery,
  MemberWithLedger,
  OperationCheckpointRecord,
  PublicAccountSnapshot,
  ReplayValidationResult,
  ReverseTransactionRequest,
  RestoreCheckpointRequest,
  SellRequest,
  StockBonusRequest,
  TransactionDetailRecord,
  TransactionRecord,
  WithdrawCashRequest,
} from '../shared/types';

type DesktopApi = {
  createMember: (payload: CreateMemberRequest) => Promise<ApiResult<MemberWithLedger>>;
  listMembers: () => Promise<ApiResult<MemberWithLedger[]>>;
  executeBuy: (payload: BuyRequest) => Promise<ApiResult<boolean>>;
  executeSell: (payload: SellRequest) => Promise<ApiResult<boolean>>;
  executeDividend: (payload: DividendRequest) => Promise<ApiResult<boolean>>;
  reverseTransaction: (payload: ReverseTransactionRequest) => Promise<ApiResult<boolean>>;
  executeWithdrawCash: (payload: WithdrawCashRequest) => Promise<ApiResult<boolean>>;
  executeStockBonus: (payload: StockBonusRequest) => Promise<ApiResult<boolean>>;
  executeMemberExit: (payload: ExitMemberRequest) => Promise<ApiResult<boolean>>;
  listTransactions: () => Promise<ApiResult<TransactionRecord[]>>;
  listTransactionDetails: () => Promise<ApiResult<TransactionDetailRecord[]>>;
  getPublicAccount: () => Promise<ApiResult<PublicAccountSnapshot | null>>;
  getHistoricalSnapshot: (payload: LedgerHistoryQuery) => Promise<ApiResult<HistoricalSnapshot>>;
  validateReplay: () => Promise<ApiResult<ReplayValidationResult>>;
  listOperationCheckpoints: () => Promise<ApiResult<OperationCheckpointRecord[]>>;
  restoreCheckpoint: (payload: RestoreCheckpointRequest) => Promise<ApiResult<OperationCheckpointRecord>>;
};

const api: DesktopApi = {
  createMember: (payload) => ipcRenderer.invoke('member:create', payload),
  listMembers: () => ipcRenderer.invoke('member:list'),
  executeBuy: (payload) => ipcRenderer.invoke('transaction:buy', payload),
  executeSell: (payload) => ipcRenderer.invoke('transaction:sell', payload),
  executeDividend: (payload) => ipcRenderer.invoke('transaction:dividend', payload),
  reverseTransaction: (payload) => ipcRenderer.invoke('transaction:reverse', payload),
  executeWithdrawCash: (payload) => ipcRenderer.invoke('transaction:withdraw', payload),
  executeStockBonus: (payload) => ipcRenderer.invoke('transaction:stockbonus', payload),
  executeMemberExit: (payload) => ipcRenderer.invoke('member:exit', payload),
  listTransactions: () => ipcRenderer.invoke('transaction:list'),
  listTransactionDetails: () => ipcRenderer.invoke('transaction:details'),
  getPublicAccount: () => ipcRenderer.invoke('account:latest'),
  getHistoricalSnapshot: (payload) => ipcRenderer.invoke('account:history-snapshot', payload),
  validateReplay: () => ipcRenderer.invoke('account:validate-replay'),
  listOperationCheckpoints: () => ipcRenderer.invoke('checkpoint:list'),
  restoreCheckpoint: (payload) => ipcRenderer.invoke('checkpoint:restore', payload),
};

contextBridge.exposeInMainWorld('desktopApi', api);
