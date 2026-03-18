import type {
  ApiResult,
  BuyRequest,
  CreateMemberRequest,
  DividendRequest,
  ExitMemberRequest,
  HistoricalSnapshot,
  LedgerHistoryQuery,
  MemberWithLedger,
  PublicAccountSnapshot,
  ReplayValidationResult,
  ReverseTransactionRequest,
  SellRequest,
  StockBonusRequest,
  TradingConfig,
  TransactionDetailRecord,
  TransactionRecord,
  UpdateTradingConfigRequest,
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
  getTradingConfig: () => Promise<ApiResult<TradingConfig>>;
  updateTradingConfig: (payload: UpdateTradingConfigRequest) => Promise<ApiResult<TradingConfig>>;
};

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}

export {};
