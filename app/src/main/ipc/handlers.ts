import { ipcMain } from 'electron';

import type {
  ApiResult,
  BuyRequest,
  CreateMemberRequest,
  DividendRequest,
  HistoricalSnapshot,
  LedgerHistoryQuery,
  PublicAccountSnapshot,
  ReplayValidationResult,
  ReverseTransactionRequest,
  SellRequest,
  TransactionDetailRecord,
  TransactionRecord,
} from '../../shared/types';
import { IPC_CHANNELS } from './channels';
import {
  createMember,
  executeBuy,
  executeDividend,
  getHistoricalSnapshot,
  executeSell,
  getLatestPublicAccount,
  listMembersWithLatestLedger,
  listTransactionDetails,
  listTransactions,
  reverseTransaction,
  validateReplayConsistency,
} from '../services/trading-service';

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = <T>(error: string): ApiResult<T> => ({ ok: false, error });

const wrap = async <T>(fn: () => T): Promise<ApiResult<T>> => {
  try {
    return ok(fn());
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return fail(message);
  }
};

export const registerIpcHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.createMember, async (_event, payload: CreateMemberRequest) =>
    wrap(() => createMember(payload)),
  );

  ipcMain.handle(IPC_CHANNELS.listMembers, async () =>
    wrap(() => listMembersWithLatestLedger()),
  );

  ipcMain.handle(IPC_CHANNELS.executeBuy, async (_event, payload: BuyRequest) =>
    wrap(() => {
      executeBuy(payload);
      return true;
    }),
  );

  ipcMain.handle(IPC_CHANNELS.executeSell, async (_event, payload: SellRequest) =>
    wrap(() => {
      executeSell(payload);
      return true;
    }),
  );

  ipcMain.handle(IPC_CHANNELS.executeDividend, async (_event, payload: DividendRequest) =>
    wrap(() => {
      executeDividend(payload);
      return true;
    }),
  );

  ipcMain.handle(IPC_CHANNELS.reverseTransaction, async (_event, payload: ReverseTransactionRequest) =>
    wrap(() => {
      reverseTransaction(payload);
      return true;
    }),
  );

  ipcMain.handle(IPC_CHANNELS.listTransactions, async () =>
    wrap<TransactionRecord[]>(() => listTransactions()),
  );

  ipcMain.handle(IPC_CHANNELS.listTransactionDetails, async () =>
    wrap<TransactionDetailRecord[]>(() => listTransactionDetails()),
  );

  ipcMain.handle(IPC_CHANNELS.getPublicAccount, async () =>
    wrap<PublicAccountSnapshot | null>(() => getLatestPublicAccount()),
  );

  ipcMain.handle(IPC_CHANNELS.getHistoricalSnapshot, async (_event, payload: LedgerHistoryQuery) =>
    wrap<HistoricalSnapshot>(() => getHistoricalSnapshot(payload)),
  );

  ipcMain.handle(IPC_CHANNELS.validateReplay, async () =>
    wrap<ReplayValidationResult>(() => validateReplayConsistency()),
  );
};
