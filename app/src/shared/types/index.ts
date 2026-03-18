export type MemberStatus = 'active' | 'exited';
export type TransactionType = 'buy' | 'sell' | 'dividend' | 'reversal' | 'withdrawal' | 'stock_bonus' | 'member_exit';

export interface Member {
  id: string;
  name: string;
  joinDate: string;
  status: MemberStatus;
}

export interface LedgerSnapshot {
  memberId: string;
  asOfTime: string;
  cash: string;
  shares: string;
  cost: string;
  avgPrice: string;
  realizedProfit: string;
}

export interface MemberWithLedger extends Member {
  ledger: LedgerSnapshot;
}

export interface BuyParticipantInput {
  memberId: string;
  shares: string;
}

export interface SellParticipantInput {
  memberId: string;
  shares: string;
}

export interface BuyRequest {
  transTime: string;
  price: string;
  participants: BuyParticipantInput[];
}

export interface SellRequest {
  transTime: string;
  price: string;
  participants: SellParticipantInput[];
}

export interface DividendRequest {
  transTime: string;
  perShareDividend: string;
}

export interface CreateMemberRequest {
  name: string;
  joinDate: string;
  initialCash: string;
}

export interface PublicAccountSnapshot {
  asOfTime: string;
  totalCash: string;
  totalShares: string;
}

export interface TransactionRecord {
  id: string;
  transTime: string;
  type: TransactionType;
  price: string;
  totalShares: string;
  totalAmount: string;
  totalCommission: string;
  totalTax: string;
  status: 'confirmed' | 'reversed';
}

export interface TransactionDetailRecord {
  id: string;
  transId: string;
  memberId: string;
  memberName: string;
  shares: string;
  amount: string;
  commission: string;
  tax: string;
  netCash: string;
  costAdjust: string;
  realizedProfit: string;
}

export interface LedgerHistoryQuery {
  asOfTime: string;
}

export interface HistoricalSnapshot {
  asOfTime: string;
  publicAccount: PublicAccountSnapshot;
  members: MemberWithLedger[];
}

export interface ReverseTransactionRequest {
  transId: string;
  reverseTime: string;
}

export interface WithdrawCashRequest {
  memberId: string;
  amount: string;
  transTime: string;
}

export interface StockBonusRequest {
  bonusRatio: string;
  transTime: string;
}

export interface ExitMemberRequest {
  memberId: string;
  exitPrice: string;
  transTime: string;
}

export interface ReplayValidationFailure {
  asOfTime: string;
  expectedCash: string;
  actualCash: string;
  expectedShares: string;
  actualShares: string;
}

export interface ReplayValidationResult {
  ok: boolean;
  checkedSnapshots: number;
  failedSnapshots: number;
  failures: ReplayValidationFailure[];
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
