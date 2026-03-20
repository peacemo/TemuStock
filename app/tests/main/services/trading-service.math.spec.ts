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
  listMembersWithLatestLedger,
  reverseTransaction,
  validateReplayConsistency,
} from '../../../src/main/services/trading-service';
import { D } from '../../../src/shared/utils/decimal';

const assertDecimalEqual = (actual: string, expected: string): void => {
  expect(D(actual).equals(D(expected)), `expected ${actual} to equal ${expected}`).toBe(true);
};

const resetDatabase = (db: Database): void => {
  db.exec(`
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
    assertDecimalEqual(ledgerA!.cost, '1001.67');
    assertDecimalEqual(ledgerA!.avgPrice, '10.0167');
    assertDecimalEqual(ledgerA!.realizedProfit, '0');

    assertDecimalEqual(ledgerB!.cash, '0');
    assertDecimalEqual(ledgerB!.shares, '200');
    assertDecimalEqual(ledgerB!.cost, '2003.33');
    assertDecimalEqual(ledgerB!.avgPrice, '10.0167');
    assertDecimalEqual(ledgerB!.realizedProfit, '0');

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
    assertDecimalEqual(ledgerA!.cost, '601');
    assertDecimalEqual(ledgerA!.avgPrice, '10.0167');
    assertDecimalEqual(ledgerA!.realizedProfit, '77.42');

    assertDecimalEqual(ledgerB!.cash, '1195.23');
    assertDecimalEqual(ledgerB!.shares, '100');
    assertDecimalEqual(ledgerB!.cost, '1001.66');
    assertDecimalEqual(ledgerB!.avgPrice, '10.0167');
    assertDecimalEqual(ledgerB!.realizedProfit, '193.56');

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
    assertDecimalEqual(ledgerA!.cost, '601');
    assertDecimalEqual(ledgerA!.avgPrice, '9.1061');

    assertDecimalEqual(ledgerB!.cash, '1245.23');
    assertDecimalEqual(ledgerB!.shares, '110');
    assertDecimalEqual(ledgerB!.cost, '1001.66');
    assertDecimalEqual(ledgerB!.avgPrice, '9.106');

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
    assertDecimalEqual(ledgerB!.cost, '1001.66');

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
    assertDecimalEqual(beforeA!.realizedProfit, '0');
    assertDecimalEqual(beforeB!.realizedProfit, '0');

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
});