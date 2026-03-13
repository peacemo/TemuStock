import type {
  ApiResult,
  BuyRequest,
  CreateMemberRequest,
  DividendRequest,
  HistoricalSnapshot,
  LedgerHistoryQuery,
  MemberWithLedger,
  PublicAccountSnapshot,
  ReplayValidationResult,
  ReverseTransactionRequest,
  SellRequest,
  TransactionDetailRecord,
  TransactionRecord,
} from '../shared/types';

type DesktopApi = {
  createMember: (payload: CreateMemberRequest) => Promise<ApiResult<MemberWithLedger>>;
  listMembers: () => Promise<ApiResult<MemberWithLedger[]>>;
  executeBuy: (payload: BuyRequest) => Promise<ApiResult<boolean>>;
  executeSell: (payload: SellRequest) => Promise<ApiResult<boolean>>;
  executeDividend: (payload: DividendRequest) => Promise<ApiResult<boolean>>;
  reverseTransaction: (payload: ReverseTransactionRequest) => Promise<ApiResult<boolean>>;
  listTransactions: () => Promise<ApiResult<TransactionRecord[]>>;
  listTransactionDetails: () => Promise<ApiResult<TransactionDetailRecord[]>>;
  getPublicAccount: () => Promise<ApiResult<PublicAccountSnapshot | null>>;
  getHistoricalSnapshot: (payload: LedgerHistoryQuery) => Promise<ApiResult<HistoricalSnapshot>>;
  validateReplay: () => Promise<ApiResult<ReplayValidationResult>>;
};

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}

export {};
