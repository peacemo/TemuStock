import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Database } from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getDatabase, initializeDatabase } from '../../../src/main/database';
import {
  createMember,
  executeBuy,
  executeDividend,
  executeMemberExit,
  executeSell,
  executeStockBonus,
  getLatestPublicAccount,
  listOperationCheckpoints,
  listMembersWithLatestLedger,
  listTransactions,
  reverseTransaction,
  restoreToCheckpoint,
  validateReplayConsistency,
} from '../../../src/main/services/trading-service';
import { D } from '../../../src/shared/utils/decimal';

const assertDecimalEqual = (actual: string, expected: string): void => {
  expect(D(actual).equals(D(expected)), `expected ${actual} to equal ${expected}`).toBe(true);
};

const resetDatabase = (db: Database): void => {
  db.exec(`
    DELETE FROM checkpoint_transaction_details;
    DELETE FROM checkpoint_transactions;
    DELETE FROM checkpoint_ledger_snapshots;
    DELETE FROM checkpoint_account_snapshots;
    DELETE FROM checkpoint_members;
    DELETE FROM operation_checkpoints;
    DELETE FROM transaction_details;
    DELETE FROM transactions;
    DELETE FROM ledger_snapshots;
    DELETE FROM account_snapshots;
    DELETE FROM members;
  `);
};

describe.sequential('trading-service core math logic', () => {
  let tmpDir: string;
  let db: Database;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temustock-test-'));
    db = initializeDatabase(tmpDir);
  });

  beforeEach(() => {
    resetDatabase(db);
  });

  afterAll(() => {
    try {
      db.close();
    } catch {
      // Ignore close errors during test teardown.
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('calculates buy allocations with extra expense and auto-deposit correctly', () => {
    const a = createMember({
      name: 'A',
      joinDate: '2026-03-18T09:00:00.000Z',
      initialCash: '0',
    });
    const b = createMember({
      name: 'B',
      joinDate: '2026-03-18T09:00:01.000Z',
      initialCash: '0',
    });

    executeBuy({
      transTime: '2026-03-18T10:00:00.000Z',
      price: '10',
      totalFeeAmount: '5',
      participants: [
        { memberId: a.id, shares: '100' },
        { memberId: b.id, shares: '200' },
      ],
    });

    const members = listMembersWithLatestLedger();
    const ledgerA = members.find((m) => m.id === a.id)?.ledger;
    const ledgerB = members.find((m) => m.id === b.id)?.ledger;
    expect(ledgerA).toBeDefined();
    expect(ledgerB).toBeDefined();

    assertDecimalEqual(ledgerA!.cash, '0');
    assertDecimalEqual(ledgerA!.shares, '100');
    assertDecimalEqual(ledgerA!.cost, '1000');
    assertDecimalEqual(ledgerA!.avgPrice, '10');
    assertDecimalEqual(ledgerA!.realizedProfit, '-1.67');

    assertDecimalEqual(ledgerB!.cash, '0');
    assertDecimalEqual(ledgerB!.shares, '200');
    assertDecimalEqual(ledgerB!.cost, '2000');
    assertDecimalEqual(ledgerB!.avgPrice, '10');
    assertDecimalEqual(ledgerB!.realizedProfit, '-3.33');

    const account = getLatestPublicAccount();
    expect(account).not.toBeNull();
    assertDecimalEqual(account!.totalCash, '0');
    assertDecimalEqual(account!.totalShares, '300');

    const tx = getDatabase()
      .prepare(
        `
        SELECT total_amount, total_extra_expense
        FROM transactions
        WHERE type = 'buy'
        ORDER BY created_at DESC
        LIMIT 1
        `,
      )
      .get() as { total_amount: string; total_extra_expense: string };

    assertDecimalEqual(tx.total_amount, '3005');
    assertDecimalEqual(tx.total_extra_expense, '5');
  });

  it('keeps replay validation consistent when auto-deposit and buy share the same timestamp', () => {
    const member = createMember({
      name: 'test',
      joinDate: '2026-03-18T09:00:00.000Z',
      initialCash: '0',
    });

    executeBuy({
      transTime: '2026-03-18T10:00:00.000Z',
      price: '10',
      totalFeeAmount: '0',
      participants: [{ memberId: member.id, shares: '100' }],
    });

    const replayResult = validateReplayConsistency();
    expect(replayResult.ok).toBe(true);
    expect(replayResult.failedSnapshots).toBe(0);
  });

  it('calculates sell extra expense and realized profit correctly', () => {
    const a = createMember({
      name: 'A',
      joinDate: '2026-03-18T09:00:00.000Z',
      initialCash: '0',
    });
    const b = createMember({
      name: 'B',
      joinDate: '2026-03-18T09:00:01.000Z',
      initialCash: '0',
    });

    executeBuy({
      transTime: '2026-03-18T10:00:00.000Z',
      price: '10',
      totalFeeAmount: '5',
      participants: [
        { memberId: a.id, shares: '100' },
        { memberId: b.id, shares: '200' },
      ],
    });

    executeSell({
      transTime: '2026-03-18T11:00:00.000Z',
      price: '12',
      totalFeeAmount: '6.68',
      participants: [
        { memberId: a.id, shares: '40' },
        { memberId: b.id, shares: '100' },
      ],
    });

    const members = listMembersWithLatestLedger();
    const ledgerA = members.find((m) => m.id === a.id)?.ledger;
    const ledgerB = members.find((m) => m.id === b.id)?.ledger;
    expect(ledgerA).toBeDefined();
    expect(ledgerB).toBeDefined();

    assertDecimalEqual(ledgerA!.cash, '478.09');
    assertDecimalEqual(ledgerA!.shares, '60');
    assertDecimalEqual(ledgerA!.cost, '600');
    assertDecimalEqual(ledgerA!.avgPrice, '10');
    assertDecimalEqual(ledgerA!.realizedProfit, '76.42');

    assertDecimalEqual(ledgerB!.cash, '1195.23');
    assertDecimalEqual(ledgerB!.shares, '100');
    assertDecimalEqual(ledgerB!.cost, '1000');
    assertDecimalEqual(ledgerB!.avgPrice, '10');
    assertDecimalEqual(ledgerB!.realizedProfit, '191.9');

    const account = getLatestPublicAccount();
    expect(account).not.toBeNull();
    assertDecimalEqual(account!.totalCash, '1673.32');
    assertDecimalEqual(account!.totalShares, '160');

    const tx = getDatabase()
      .prepare(
        `
        SELECT total_amount, total_extra_expense
        FROM transactions
        WHERE type = 'sell'
        ORDER BY created_at DESC
        LIMIT 1
        `,
      )
      .get() as { total_amount: string; total_extra_expense: string };

    assertDecimalEqual(tx.total_amount, '1680');
    assertDecimalEqual(tx.total_extra_expense, '6.68');
  });

  it('keeps cost invariant through dividend and stock bonus with expected rounding', () => {
    const a = createMember({
      name: 'A',
      joinDate: '2026-03-18T09:00:00.000Z',
      initialCash: '0',
    });
    const b = createMember({
      name: 'B',
      joinDate: '2026-03-18T09:00:01.000Z',
      initialCash: '0',
    });

    executeBuy({
      transTime: '2026-03-18T10:00:00.000Z',
      price: '10',
      totalFeeAmount: '5',
      participants: [
        { memberId: a.id, shares: '100' },
        { memberId: b.id, shares: '200' },
      ],
    });

    executeSell({
      transTime: '2026-03-18T11:00:00.000Z',
      price: '12',
      totalFeeAmount: '6.68',
      participants: [
        { memberId: a.id, shares: '40' },
        { memberId: b.id, shares: '100' },
      ],
    });

    executeDividend({
      transTime: '2026-03-18T12:00:00.000Z',
      perShareDividend: '0.5',
    });

    executeStockBonus({
      transTime: '2026-03-18T13:00:00.000Z',
      bonusRatio: '0.1',
    });

    const members = listMembersWithLatestLedger();
    const ledgerA = members.find((m) => m.id === a.id)?.ledger;
    const ledgerB = members.find((m) => m.id === b.id)?.ledger;
    expect(ledgerA).toBeDefined();
    expect(ledgerB).toBeDefined();

    assertDecimalEqual(ledgerA!.cash, '508.09');
    assertDecimalEqual(ledgerA!.shares, '66');
    assertDecimalEqual(ledgerA!.cost, '600');
    assertDecimalEqual(ledgerA!.avgPrice, '9.0909');

    assertDecimalEqual(ledgerB!.cash, '1245.23');
    assertDecimalEqual(ledgerB!.shares, '110');
    assertDecimalEqual(ledgerB!.cost, '1000');
    assertDecimalEqual(ledgerB!.avgPrice, '9.0909');

    const account = getLatestPublicAccount();
    expect(account).not.toBeNull();
    assertDecimalEqual(account!.totalCash, '1753.32');
    assertDecimalEqual(account!.totalShares, '176');
  });

  it('executes member exit with full liquidation and keeps conservation', () => {
    const a = createMember({
      name: 'A',
      joinDate: '2026-03-18T09:00:00.000Z',
      initialCash: '0',
    });
    const b = createMember({
      name: 'B',
      joinDate: '2026-03-18T09:00:01.000Z',
      initialCash: '0',
    });

    executeBuy({
      transTime: '2026-03-18T10:00:00.000Z',
      price: '10',
      totalFeeAmount: '5',
      participants: [
        { memberId: a.id, shares: '100' },
        { memberId: b.id, shares: '200' },
      ],
    });

    executeSell({
      transTime: '2026-03-18T11:00:00.000Z',
      price: '12',
      totalFeeAmount: '6.68',
      participants: [
        { memberId: a.id, shares: '40' },
        { memberId: b.id, shares: '100' },
      ],
    });

    executeDividend({
      transTime: '2026-03-18T12:00:00.000Z',
      perShareDividend: '0.5',
    });

    executeStockBonus({
      transTime: '2026-03-18T13:00:00.000Z',
      bonusRatio: '0.1',
    });

    executeMemberExit({
      memberId: a.id,
      exitPrice: '11',
      transTime: '2026-03-18T14:00:00.000Z',
      totalFeeAmount: '5.73',
    });

    const members = listMembersWithLatestLedger();
    const ledgerA = members.find((m) => m.id === a.id)?.ledger;
    const ledgerB = members.find((m) => m.id === b.id)?.ledger;
    const memberA = members.find((m) => m.id === a.id);
    expect(ledgerA).toBeDefined();
    expect(ledgerB).toBeDefined();

    assertDecimalEqual(ledgerA!.cash, '0');
    assertDecimalEqual(ledgerA!.shares, '0');
    assertDecimalEqual(ledgerA!.cost, '0');
    expect(memberA?.status).toBe('exited');

    assertDecimalEqual(ledgerB!.cash, '1245.23');
    assertDecimalEqual(ledgerB!.shares, '110');
    assertDecimalEqual(ledgerB!.cost, '1000');

    const account = getLatestPublicAccount();
    expect(account).not.toBeNull();
    assertDecimalEqual(account!.totalCash, '1245.23');
    assertDecimalEqual(account!.totalShares, '110');

    const totals = members.reduce(
      (acc, member) => ({
        cash: acc.cash.plus(D(member.ledger.cash)),
        shares: acc.shares.plus(D(member.ledger.shares)),
      }),
      { cash: D(0), shares: D(0) },
    );

    assertDecimalEqual(totals.cash.toString(), account!.totalCash);
    assertDecimalEqual(totals.shares.toString(), account!.totalShares);
  });

  it('persists manual extra expense values in buy and sell transactions', () => {
    const a = createMember({
      name: 'A',
      joinDate: '2026-03-18T09:00:00.000Z',
      initialCash: '0',
    });
    const b = createMember({
      name: 'B',
      joinDate: '2026-03-18T09:00:01.000Z',
      initialCash: '0',
    });

    executeBuy({
      transTime: '2026-03-18T10:00:00.000Z',
      price: '10',
      totalFeeAmount: '8',
      participants: [
        { memberId: a.id, shares: '100' },
        { memberId: b.id, shares: '200' },
      ],
    });

    executeSell({
      transTime: '2026-03-18T11:00:00.000Z',
      price: '12',
      totalFeeAmount: '11.36',
      participants: [
        { memberId: a.id, shares: '40' },
        { memberId: b.id, shares: '100' },
      ],
    });

    const buyTx = getDatabase()
      .prepare(
        `
        SELECT total_amount, total_extra_expense
        FROM transactions
        WHERE type = 'buy'
        ORDER BY created_at DESC
        LIMIT 1
        `,
      )
      .get() as { total_amount: string; total_extra_expense: string };

    assertDecimalEqual(buyTx.total_amount, '3008');
    assertDecimalEqual(buyTx.total_extra_expense, '8');

    const sellTx = getDatabase()
      .prepare(
        `
        SELECT total_amount, total_extra_expense
        FROM transactions
        WHERE type = 'sell'
        ORDER BY created_at DESC
        LIMIT 1
        `,
      )
      .get() as { total_amount: string; total_extra_expense: string };

    assertDecimalEqual(sellTx.total_amount, '1680');
    assertDecimalEqual(sellTx.total_extra_expense, '11.36');
  });

  it('restores realized profit after reversing a buy transaction', () => {
    const a = createMember({
      name: 'A',
      joinDate: '2026-03-18T09:00:00.000Z',
      initialCash: '0',
    });
    const b = createMember({
      name: 'B',
      joinDate: '2026-03-18T09:00:01.000Z',
      initialCash: '0',
    });

    executeBuy({
      transTime: '2026-03-18T10:00:00.000Z',
      price: '10',
      totalFeeAmount: '5',
      participants: [
        { memberId: a.id, shares: '100' },
        { memberId: b.id, shares: '200' },
      ],
    });

    const beforeReverse = listMembersWithLatestLedger();
    const beforeA = beforeReverse.find((m) => m.id === a.id)?.ledger;
    const beforeB = beforeReverse.find((m) => m.id === b.id)?.ledger;
    expect(beforeA).toBeDefined();
    expect(beforeB).toBeDefined();
    assertDecimalEqual(beforeA!.realizedProfit, '-1.67');
    assertDecimalEqual(beforeB!.realizedProfit, '-3.33');

    const buyTx = getDatabase()
      .prepare(
        `
        SELECT id
        FROM transactions
        WHERE type = 'buy'
        ORDER BY created_at DESC
        LIMIT 1
        `,
      )
      .get() as { id: string };

    reverseTransaction({
      transId: buyTx.id,
      reverseTime: '2026-03-18T10:30:00.000Z',
    });

    const afterReverse = listMembersWithLatestLedger();
    const afterA = afterReverse.find((m) => m.id === a.id)?.ledger;
    const afterB = afterReverse.find((m) => m.id === b.id)?.ledger;
    expect(afterA).toBeDefined();
    expect(afterB).toBeDefined();

    assertDecimalEqual(afterA!.cash, '1001.67');
    assertDecimalEqual(afterA!.shares, '0');
    assertDecimalEqual(afterA!.cost, '0');
    assertDecimalEqual(afterA!.realizedProfit, '0');

    assertDecimalEqual(afterB!.cash, '2003.33');
    assertDecimalEqual(afterB!.shares, '0');
    assertDecimalEqual(afterB!.cost, '0');
    assertDecimalEqual(afterB!.realizedProfit, '0');
  });

  it('creates checkpoints for write operations and restores the full ledger state', () => {
    const member = createMember({
      name: 'A',
      joinDate: '2026-03-19T09:00:00.000Z',
      initialCash: '1000',
    });

    executeBuy({
      transTime: '2026-03-19T10:00:00.000Z',
      price: '10',
      totalFeeAmount: '0',
      participants: [{ memberId: member.id, shares: '100' }],
    });

    const checkpointsAfterBuy = listOperationCheckpoints();
    expect(checkpointsAfterBuy).toHaveLength(2);
    expect(checkpointsAfterBuy[0].operationType).toBe('transaction.buy');
    expect(checkpointsAfterBuy[1].operationType).toBe('member.create');

    const afterBuyLedger = listMembersWithLatestLedger()[0].ledger;
    const afterBuyAccount = getLatestPublicAccount();
    expect(afterBuyAccount).not.toBeNull();

    executeDividend({
      transTime: '2026-03-19T11:00:00.000Z',
      perShareDividend: '0.5',
    });

    executeSell({
      transTime: '2026-03-19T12:00:00.000Z',
      price: '12',
      totalFeeAmount: '0',
      participants: [{ memberId: member.id, shares: '50' }],
    });

    const restored = restoreToCheckpoint({
      checkpointId: checkpointsAfterBuy[0].checkpointId,
      restoreTime: '2026-03-19T13:00:00.000Z',
    });

    expect(restored.operationType).toBe('checkpoint.restore');
    expect(restored.restoredFromCheckpointId).toBe(checkpointsAfterBuy[0].checkpointId);

    const restoredLedger = listMembersWithLatestLedger()[0].ledger;
    const restoredAccount = getLatestPublicAccount();
    expect(restoredAccount).not.toBeNull();

    assertDecimalEqual(restoredLedger.cash, afterBuyLedger.cash);
    assertDecimalEqual(restoredLedger.shares, afterBuyLedger.shares);
    assertDecimalEqual(restoredLedger.cost, afterBuyLedger.cost);
    assertDecimalEqual(restoredLedger.avgPrice, afterBuyLedger.avgPrice);
    assertDecimalEqual(restoredLedger.realizedProfit, afterBuyLedger.realizedProfit);
    assertDecimalEqual(restoredAccount!.totalCash, afterBuyAccount!.totalCash);
    assertDecimalEqual(restoredAccount!.totalShares, afterBuyAccount!.totalShares);

    const transactions = listTransactions();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe('buy');
    assertDecimalEqual(transactions[0].totalShares, '100');

    const replayResult = validateReplayConsistency();
    expect(replayResult.ok).toBe(true);

    const checkpointsAfterRestore = listOperationCheckpoints();
    expect(checkpointsAfterRestore[0].operationType).toBe('checkpoint.restore');
    expect(checkpointsAfterRestore[0].restoredFromCheckpointId).toBe(checkpointsAfterBuy[0].checkpointId);
  });
});
