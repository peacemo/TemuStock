import crypto from 'node:crypto';

import type { Database } from 'better-sqlite3';
import DecimalJs from 'decimal.js';

import { getDatabase } from '../database';
import { TRADING_CONFIG } from '../../shared/constants/trading';
import { D, isPositive, roundAmount, roundAvgPrice, roundPrice, roundShares } from '../../shared/utils/decimal';
import type {
  BuyParticipantInput,
  BuyRequest,
  CreateMemberRequest,
  DividendRequest,
  HistoricalSnapshot,
  LedgerHistoryQuery,
  LedgerSnapshot,
  MemberWithLedger,
  PublicAccountSnapshot,
  ReplayValidationFailure,
  ReplayValidationResult,
  ReverseTransactionRequest,
  SellParticipantInput,
  SellRequest,
  TransactionDetailRecord,
  TransactionRecord,
} from '../../shared/types';

type LedgerRow = {
  member_id: string;
  as_of_time: string;
  cash: string;
  shares: string;
  cost: string;
  avg_price: string;
  realized_profit: string;
};

type MemberRow = {
  id: string;
  name: string;
  join_date: string;
  status: 'active' | 'exited';
};

const checksumOf = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

const nowIso = (): string => new Date().toISOString();

const id = (): string => crypto.randomUUID();

const allocateRoundedByWeights = (
  total: DecimalJs,
  weights: DecimalJs[],
  rounder: (value: DecimalJs.Value) => DecimalJs,
): DecimalJs[] => {
  if (!weights.length) {
    return [];
  }

  const totalWeight = weights.reduce((acc, weight) => acc.plus(weight), D(0));
  if (totalWeight.equals(0)) {
    return weights.map(() => D(0));
  }

  const allocations: DecimalJs[] = [];
  let remainingTotal = D(total);
  let remainingWeight = totalWeight;

  weights.forEach((weight, index) => {
    if (index === weights.length - 1) {
      allocations.push(rounder(remainingTotal));
      return;
    }

    const value = rounder(remainingTotal.times(weight).div(remainingWeight));
    allocations.push(value);
    remainingTotal = remainingTotal.minus(value);
    remainingWeight = remainingWeight.minus(weight);
  });

  return allocations;
};

const ledgerToSnapshot = (row: LedgerRow): LedgerSnapshot => ({
  memberId: row.member_id,
  asOfTime: row.as_of_time,
  cash: row.cash,
  shares: row.shares,
  cost: row.cost,
  avgPrice: row.avg_price,
  realizedProfit: row.realized_profit,
});

const getLatestLedgerByMember = (db: Database, memberId: string): LedgerRow => {
  const row = db
    .prepare(
      `
      SELECT member_id, as_of_time, cash, shares, cost, avg_price, realized_profit
      FROM ledger_snapshots
      WHERE member_id = ?
      ORDER BY seq DESC
      LIMIT 1
      `,
    )
    .get(memberId) as LedgerRow | undefined;

  if (!row) {
    throw new Error(`成员 ${memberId} 没有可用账本快照`);
  }

  return row;
};

const getLatestLedgersForAllMembers = (db: Database): LedgerRow[] => {
  return db
    .prepare(
      `
      SELECT ls.member_id, ls.as_of_time, ls.cash, ls.shares, ls.cost, ls.avg_price, ls.realized_profit
      FROM ledger_snapshots ls
      INNER JOIN (
        SELECT member_id, MAX(seq) AS max_seq
        FROM ledger_snapshots
        GROUP BY member_id
      ) grouped
        ON ls.member_id = grouped.member_id AND ls.seq = grouped.max_seq
      ORDER BY ls.member_id
      `,
    )
    .all() as LedgerRow[];
};

const insertLedgerSnapshot = (
  db: Database,
  row: {
    memberId: string;
    asOfTime: string;
    cash: string;
    shares: string;
    cost: string;
    avgPrice: string;
    realizedProfit: string;
    eventId: string;
  },
): void => {
  const payload = `${row.memberId}|${row.asOfTime}|${row.cash}|${row.shares}|${row.cost}|${row.avgPrice}|${row.realizedProfit}|${row.eventId}`;
  db.prepare(
    `
    INSERT INTO ledger_snapshots
      (id, member_id, as_of_time, cash, shares, cost, avg_price, realized_profit, checksum, event_id)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id(),
    row.memberId,
    row.asOfTime,
    row.cash,
    row.shares,
    row.cost,
    row.avgPrice,
    row.realizedProfit,
    checksumOf(payload),
    row.eventId,
  );
};

const insertAccountSnapshot = (db: Database, asOfTime: string, eventId: string): PublicAccountSnapshot => {
  const ledgers = getLatestLedgersForAllMembers(db);

  const totalCash = ledgers
    .reduce((acc, ledger) => acc.plus(D(ledger.cash)), D(0))
    .toDecimalPlaces(2)
    .toString();
  const totalShares = ledgers
    .reduce((acc, ledger) => acc.plus(D(ledger.shares)), D(0))
    .toDecimalPlaces(3)
    .toString();

  const payload = `${asOfTime}|${totalCash}|${totalShares}|${eventId}`;
  db.prepare(
    `
    INSERT INTO account_snapshots
      (id, as_of_time, total_cash, total_shares, checksum, event_id)
    VALUES
      (?, ?, ?, ?, ?, ?)
    `,
  ).run(id(), asOfTime, totalCash, totalShares, checksumOf(payload), eventId);

  return {
    asOfTime,
    totalCash,
    totalShares,
  };
};

const validateConservation = (db: Database): void => {
  const latestAccount = db
    .prepare(
      `
      SELECT total_cash, total_shares
      FROM account_snapshots
      ORDER BY seq DESC
      LIMIT 1
      `,
    )
    .get() as { total_cash: string; total_shares: string } | undefined;

  if (!latestAccount) {
    return;
  }

  const ledgers = getLatestLedgersForAllMembers(db);
  const sumCash = ledgers.reduce((acc, ledger) => acc.plus(D(ledger.cash)), D(0));
  const sumShares = ledgers.reduce((acc, ledger) => acc.plus(D(ledger.shares)), D(0));

  if (
    sumCash.minus(D(latestAccount.total_cash)).abs().greaterThan(D('0.01')) ||
    sumShares.minus(D(latestAccount.total_shares)).abs().greaterThan(D('0.001'))
  ) {
    throw new Error('守恒定律校验失败：个人汇总与公共账户不一致');
  }
};

const ensureMemberExists = (db: Database, memberId: string): MemberRow => {
  const member = db.prepare('SELECT id, name, join_date, status FROM members WHERE id = ?').get(memberId) as
    | MemberRow
    | undefined;
  if (!member) {
    throw new Error(`成员 ${memberId} 不存在`);
  }
  if (member.status !== 'active') {
    throw new Error(`成员 ${member.name} 状态不是 active`);
  }
  return member;
};

export const listMembersWithLatestLedger = (): MemberWithLedger[] => {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT m.id, m.name, m.join_date, m.status,
             ls.member_id, ls.as_of_time, ls.cash, ls.shares, ls.cost, ls.avg_price, ls.realized_profit
      FROM members m
      LEFT JOIN (
        SELECT x.*
        FROM ledger_snapshots x
        INNER JOIN (
          SELECT member_id, MAX(seq) AS max_seq
          FROM ledger_snapshots
          GROUP BY member_id
        ) latest ON x.member_id = latest.member_id AND x.seq = latest.max_seq
      ) ls ON m.id = ls.member_id
      ORDER BY m.join_date ASC
      `,
    )
    .all() as Array<
    MemberRow & {
      member_id: string | null;
      as_of_time: string | null;
      cash: string | null;
      shares: string | null;
      cost: string | null;
      avg_price: string | null;
      realized_profit: string | null;
    }
  >;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    joinDate: row.join_date,
    status: row.status,
    ledger: {
      memberId: row.member_id ?? row.id,
      asOfTime: row.as_of_time ?? row.join_date,
      cash: row.cash ?? '0',
      shares: row.shares ?? '0',
      cost: row.cost ?? '0',
      avgPrice: row.avg_price ?? '0',
      realizedProfit: row.realized_profit ?? '0',
    },
  }));
};

export const listTransactions = (): TransactionRecord[] => {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT id, trans_time, type, price, total_shares, total_amount, total_commission, total_tax, status
      FROM transactions
      ORDER BY trans_time DESC, created_at DESC
      `,
    )
    .all() as Array<{
    id: string;
        type: 'buy' | 'sell' | 'dividend' | 'reversal';
    type: 'buy' | 'sell' | 'dividend';
    price: string;
    total_shares: string;
    total_amount: string;
    total_commission: string;
    total_tax: string;
    status: 'confirmed' | 'reversed';
  }>;

  return rows.map((row) => ({
    id: row.id,
    transTime: row.trans_time,
    type: row.type,
    price: row.price,
    totalShares: row.total_shares,
    totalAmount: row.total_amount,
    totalCommission: row.total_commission,
    totalTax: row.total_tax,
    status: row.status,
  }));
};

export const validateReplayConsistency = (): ReplayValidationResult => {
  const db = getDatabase();
  const snapshots = db
    .prepare(
      `
      SELECT as_of_time, total_cash, total_shares
      FROM account_snapshots
      ORDER BY seq ASC
      `,
    )
    .all() as Array<{ as_of_time: string; total_cash: string; total_shares: string }>;

  const failures: ReplayValidationFailure[] = [];

  snapshots.forEach((snapshot) => {
    const rows = db
      .prepare(
        `
        SELECT ls.cash, ls.shares
        FROM ledger_snapshots ls
        INNER JOIN (
          SELECT member_id, MAX(seq) AS max_seq
          FROM ledger_snapshots
          WHERE as_of_time <= ?
          GROUP BY member_id
        ) latest
          ON ls.member_id = latest.member_id AND ls.seq = latest.max_seq
        `,
      )
      .all(snapshot.as_of_time) as Array<{ cash: string; shares: string }>;

    const actualCash = roundAmount(rows.reduce((acc, row) => acc.plus(D(row.cash)), D(0))).toString();
    const actualShares = roundShares(rows.reduce((acc, row) => acc.plus(D(row.shares)), D(0))).toString();

    const expectedCash = roundAmount(snapshot.total_cash).toString();
    const expectedShares = roundShares(snapshot.total_shares).toString();

    if (
      D(actualCash).minus(expectedCash).abs().greaterThan(D('0.01')) ||
      D(actualShares).minus(expectedShares).abs().greaterThan(D('0.001'))
    ) {
      failures.push({
        asOfTime: snapshot.as_of_time,
        expectedCash,
        actualCash,
        expectedShares,
        actualShares,
      });
    }
  });

  return {
    ok: failures.length === 0,
    checkedSnapshots: snapshots.length,
    failedSnapshots: failures.length,
    failures,
  };
};

export const listTransactionDetails = (): TransactionDetailRecord[] => {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT td.id,
             td.trans_id,
             td.member_id,
             m.name AS member_name,
             td.shares,
             td.amount,
             td.commission,
             td.tax,
             td.net_cash,
             td.cost_adjust,
             td.realized_profit
      FROM transaction_details td
      INNER JOIN members m ON m.id = td.member_id
      ORDER BY td.created_at DESC
      `,
    )
    .all() as Array<{
    id: string;
    trans_id: string;
    member_id: string;
    member_name: string;
    shares: string;
    amount: string;
    commission: string;
    tax: string;
    net_cash: string;
    cost_adjust: string;
    realized_profit: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    transId: row.trans_id,
    memberId: row.member_id,
    memberName: row.member_name,
    shares: row.shares,
    amount: row.amount,
    commission: row.commission,
    tax: row.tax,
    netCash: row.net_cash,
    costAdjust: row.cost_adjust,
    realizedProfit: row.realized_profit,
  }));
};

export const getLatestPublicAccount = (): PublicAccountSnapshot | null => {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT as_of_time, total_cash, total_shares
      FROM account_snapshots
      ORDER BY seq DESC
      LIMIT 1
      `,
    )
    .get() as { as_of_time: string; total_cash: string; total_shares: string } | undefined;

  if (!row) {
    return null;
  }

  return {
    asOfTime: row.as_of_time,
    totalCash: row.total_cash,
    totalShares: row.total_shares,
  };
};

export const getHistoricalSnapshot = (query: LedgerHistoryQuery): HistoricalSnapshot => {
  const db = getDatabase();
  const asOfTime = query.asOfTime;

  if (!asOfTime) {
    throw new Error('历史查询时间不能为空');
  }

  const accountRow = db
    .prepare(
      `
      SELECT as_of_time, total_cash, total_shares
      FROM account_snapshots
      WHERE as_of_time <= ?
      ORDER BY as_of_time DESC, seq DESC
      LIMIT 1
      `,
    )
    .get(asOfTime) as { as_of_time: string; total_cash: string; total_shares: string } | undefined;

  if (!accountRow) {
    throw new Error('该时间点之前没有可用快照');
  }

  const memberRows = db
    .prepare(
      `
      SELECT m.id,
             m.name,
             m.join_date,
             m.status,
             ls.member_id,
             ls.as_of_time,
             ls.cash,
             ls.shares,
             ls.cost,
             ls.avg_price,
             ls.realized_profit
      FROM members m
      LEFT JOIN (
        SELECT p.*
        FROM ledger_snapshots p
        INNER JOIN (
          SELECT member_id, MAX(seq) AS max_seq
          FROM ledger_snapshots
          WHERE as_of_time <= ?
          GROUP BY member_id
        ) latest
          ON p.member_id = latest.member_id AND p.seq = latest.max_seq
      ) ls ON m.id = ls.member_id
      ORDER BY m.join_date ASC
      `,
    )
    .all(asOfTime) as Array<
    MemberRow & {
      member_id: string | null;
      as_of_time: string | null;
      cash: string | null;
      shares: string | null;
      cost: string | null;
      avg_price: string | null;
      realized_profit: string | null;
    }
  >;

  const members: MemberWithLedger[] = memberRows.map((row) => ({
    id: row.id,
    name: row.name,
    joinDate: row.join_date,
    status: row.status,
    ledger: {
      memberId: row.member_id ?? row.id,
      asOfTime: row.as_of_time ?? row.join_date,
      cash: row.cash ?? '0',
      shares: row.shares ?? '0',
      cost: row.cost ?? '0',
      avgPrice: row.avg_price ?? '0',
      realizedProfit: row.realized_profit ?? '0',
    },
  }));

  return {
    asOfTime: accountRow.as_of_time,
    publicAccount: {
      asOfTime: accountRow.as_of_time,
      totalCash: accountRow.total_cash,
      totalShares: accountRow.total_shares,
    },
    members,
  };
};

export const createMember = (request: CreateMemberRequest): MemberWithLedger => {
  const db = getDatabase();

  if (!request.name.trim()) {
    throw new Error('成员名称不能为空');
  }

  const initialCash = roundAmount(request.initialCash);
  if (!isPositive(initialCash)) {
    throw new Error('初始资金必须大于 0');
  }

  const joinDate = request.joinDate || nowIso();
  const memberId = id();
  const eventId = id();

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO members(id, name, join_date, status) VALUES (?, ?, ?, ?)').run(
      memberId,
      request.name.trim(),
      joinDate,
      'active',
    );

    insertLedgerSnapshot(db, {
      memberId,
      asOfTime: joinDate,
      cash: initialCash.toString(),
      shares: '0',
      cost: '0',
      avgPrice: '0',
      realizedProfit: '0',
      eventId,
    });

    insertAccountSnapshot(db, joinDate, eventId);
    validateConservation(db);
  });

  tx();

  if (request.immediateBuyShares && request.immediateBuyPrice) {
    executeBuy({
      transTime: joinDate,
      price: request.immediateBuyPrice,
      participants: [{
        memberId,
        shares: request.immediateBuyShares,
      }],
    });
  }

  const member = ensureMemberExists(db, memberId);
  const ledger = getLatestLedgerByMember(db, memberId);

  return {
    id: member.id,
    name: member.name,
    joinDate: member.join_date,
    status: member.status,
    ledger: ledgerToSnapshot(ledger),
  };
};

const validateBuyParticipants = (
  db: Database,
  participants: BuyParticipantInput[],
): Array<{ memberId: string; shares: ReturnType<typeof D>; ledger: LedgerRow }> => {
  if (!participants.length) {
    throw new Error('买入参与人不能为空');
  }

  const mapped = participants.map((participant) => {
    ensureMemberExists(db, participant.memberId);
    const shares = roundShares(participant.shares);
    if (!isPositive(shares)) {
      throw new Error('买入股数必须大于 0');
    }

    const ledger = getLatestLedgerByMember(db, participant.memberId);

    return {
      memberId: participant.memberId,
      shares,
      ledger,
    };
  });

  return mapped;
};

export const executeBuy = (request: BuyRequest): void => {
  const db = getDatabase();
  const price = roundPrice(request.price);
  if (!isPositive(price)) {
    throw new Error('买入价格必须大于 0');
  }

  const transTime = request.transTime || nowIso();
  const transId = id();

  const tx = db.transaction(() => {
    const participants = validateBuyParticipants(db, request.participants);

    const grossAmounts = participants.map((participant) => roundAmount(participant.shares.times(price)));
    const totalShares = roundShares(
      participants.reduce((acc, participant) => acc.plus(participant.shares), D(0)),
    );
    const totalDealAmount = roundAmount(grossAmounts.reduce((acc, amount) => acc.plus(amount), D(0)));
    const commissionRaw = roundAmount(totalDealAmount.times(TRADING_CONFIG.commissionRate));
    const commissionActual = roundAmount(DecimalJs.max(commissionRaw, D(TRADING_CONFIG.minCommission)));
    const commissions = allocateRoundedByWeights(commissionActual, grossAmounts, roundAmount);

    db.prepare(
      `
      INSERT INTO transactions
      (id, trans_time, type, price, total_shares, total_amount, total_commission, total_tax, status)
      VALUES
      (?, ?, 'buy', ?, ?, ?, ?, '0', 'confirmed')
      `,
    ).run(
      transId,
      transTime,
      price.toString(),
      totalShares.toString(),
      totalDealAmount.toString(),
      commissionActual.toString(),
    );

    participants.forEach((participant, index) => {
      const dealAmount = grossAmounts[index];
      const commission = commissions[index];
      const cashRequired = roundAmount(dealAmount.plus(commission));

      if (D(participant.ledger.cash).lessThan(cashRequired)) {
        throw new Error(`成员 ${participant.memberId} 现金不足`);
      }

      const previousShares = D(participant.ledger.shares);
      const previousCost = D(participant.ledger.cost);
      const previousCash = D(participant.ledger.cash);
      const previousProfit = D(participant.ledger.realized_profit);

      const nextShares = roundShares(previousShares.plus(participant.shares));
      const nextCost = roundAmount(previousCost.plus(dealAmount));
      const nextCash = roundAmount(previousCash.minus(cashRequired));
      const avgPrice = nextShares.greaterThan(0)
        ? roundAvgPrice(nextCost.div(nextShares))
        : D(0);

      db.prepare(
        `
        INSERT INTO transaction_details
        (id, trans_id, member_id, shares, amount, commission, tax, net_cash, cost_adjust, realized_profit)
        VALUES
        (?, ?, ?, ?, ?, ?, '0', ?, ?, '0')
        `,
      ).run(
        id(),
        transId,
        participant.memberId,
        participant.shares.toString(),
        dealAmount.toString(),
        commission.toString(),
        roundAmount(D(0).minus(cashRequired)).toString(),
        dealAmount.toString(),
      );

      insertLedgerSnapshot(db, {
        memberId: participant.memberId,
        asOfTime: transTime,
        cash: nextCash.toString(),
        shares: nextShares.toString(),
        cost: nextCost.toString(),
        avgPrice: avgPrice.toString(),
        realizedProfit: previousProfit.toString(),
        eventId: transId,
      });
    });

    insertAccountSnapshot(db, transTime, transId);
    validateConservation(db);
  });

  tx();
};

const validateSellParticipants = (
  db: Database,
  participants: SellParticipantInput[],
): Array<{ memberId: string; shares: ReturnType<typeof D>; ledger: LedgerRow }> => {
  if (!participants.length) {
    throw new Error('卖出参与人不能为空');
  }

  return participants.map((participant) => {
    ensureMemberExists(db, participant.memberId);
    const shares = roundShares(participant.shares);
    if (!isPositive(shares)) {
      throw new Error('卖出股数必须大于 0');
    }

    const ledger = getLatestLedgerByMember(db, participant.memberId);
    if (D(ledger.shares).lessThan(shares)) {
      throw new Error(`成员 ${participant.memberId} 持股不足`);
    }

    return {
      memberId: participant.memberId,
      shares,
      ledger,
    };
  });
};

export const executeSell = (request: SellRequest): void => {
  const db = getDatabase();
  const price = roundPrice(request.price);
  if (!isPositive(price)) {
    throw new Error('卖出价格必须大于 0');
  }

  const transTime = request.transTime || nowIso();
  const transId = id();

  const tx = db.transaction(() => {
    const participants = validateSellParticipants(db, request.participants);
    const totalShares = roundShares(
      participants.reduce((acc, participant) => acc.plus(participant.shares), D(0)),
    );
    const grossAmounts = participants.map((participant) => roundAmount(participant.shares.times(price)));
    const totalSellAmount = roundAmount(grossAmounts.reduce((acc, amount) => acc.plus(amount), D(0)));
    const commissionRaw = roundAmount(totalSellAmount.times(TRADING_CONFIG.commissionRate));
    const commissionActual = roundAmount(DecimalJs.max(commissionRaw, D(TRADING_CONFIG.minCommission)));
    const totalTax = roundAmount(totalSellAmount.times(TRADING_CONFIG.stampTaxRate));
    const commissions = allocateRoundedByWeights(commissionActual, grossAmounts, roundAmount);
    const taxes = allocateRoundedByWeights(totalTax, grossAmounts, roundAmount);

    db.prepare(
      `
      INSERT INTO transactions
      (id, trans_time, type, price, total_shares, total_amount, total_commission, total_tax, status)
      VALUES
      (?, ?, 'sell', ?, ?, ?, ?, ?, 'confirmed')
      `,
    ).run(
      transId,
      transTime,
      price.toString(),
      totalShares.toString(),
      totalSellAmount.toString(),
      commissionActual.toString(),
      totalTax.toString(),
    );

    participants.forEach((participant, index) => {
      const gross = grossAmounts[index];
      const commission = commissions[index];
      const tax = taxes[index];
      const netCash = roundAmount(gross.minus(commission).minus(tax));

      const prevShares = D(participant.ledger.shares);
      const prevCash = D(participant.ledger.cash);
      const prevCost = D(participant.ledger.cost);
      const prevAvg = D(participant.ledger.avg_price);
      const prevProfit = D(participant.ledger.realized_profit);

      const soldCost = prevShares.equals(participant.shares)
        ? roundAmount(prevCost)
        : roundAmount(participant.shares.times(prevAvg));
      const realizedProfit = roundAmount(netCash.minus(soldCost));

      const nextShares = roundShares(prevShares.minus(participant.shares));
      const nextCash = roundAmount(prevCash.plus(netCash));
      const nextCost = nextShares.equals(0)
        ? D(0)
        : roundAmount(prevCost.minus(soldCost));
      const nextAvg = nextShares.greaterThan(0)
        ? roundAvgPrice(nextCost.div(nextShares))
        : D(0);
      const nextRealizedProfit = roundAmount(prevProfit.plus(realizedProfit));

      db.prepare(
        `
        INSERT INTO transaction_details
        (id, trans_id, member_id, shares, amount, commission, tax, net_cash, cost_adjust, realized_profit)
        VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        id(),
        transId,
        participant.memberId,
        roundShares(D(0).minus(participant.shares)).toString(),
        gross.toString(),
        commission.toString(),
        tax.toString(),
        netCash.toString(),
        roundAmount(D(0).minus(soldCost)).toString(),
        realizedProfit.toString(),
      );

      insertLedgerSnapshot(db, {
        memberId: participant.memberId,
        asOfTime: transTime,
        cash: nextCash.toString(),
        shares: nextShares.toString(),
        cost: nextCost.toString(),
        avgPrice: nextAvg.toString(),
        realizedProfit: nextRealizedProfit.toString(),
        eventId: transId,
      });
    });

    insertAccountSnapshot(db, transTime, transId);
    validateConservation(db);
  });

  tx();
};

export const executeDividend = (request: DividendRequest): void => {
  const db = getDatabase();
  const perShare = roundAmount(request.perShareDividend);
  if (!isPositive(perShare)) {
    throw new Error('每股分红必须大于 0');
  }

  const transTime = request.transTime || nowIso();
  const transId = id();

  const tx = db.transaction(() => {
    const members = db
      .prepare('SELECT id FROM members WHERE status = ? ORDER BY join_date ASC')
      .all('active') as Array<{ id: string }>;

    if (!members.length) {
      throw new Error('当前没有活跃成员，无法分红');
    }

    const latest = members.map((member) => ({
      memberId: member.id,
      ledger: getLatestLedgerByMember(db, member.id),
    }));

    const totalShares = roundShares(
      latest.reduce((acc, row) => acc.plus(D(row.ledger.shares)), D(0)),
    );
    const totalDividend = roundAmount(totalShares.times(perShare));

    db.prepare(
      `
      INSERT INTO transactions
      (id, trans_time, type, price, total_shares, total_amount, total_commission, total_tax, status)
      VALUES
      (?, ?, 'dividend', ?, ?, ?, '0', '0', 'confirmed')
      `,
    ).run(
      transId,
      transTime,
      perShare.toString(),
      totalShares.toString(),
      totalDividend.toString(),
    );

    latest.forEach(({ memberId, ledger }) => {
      const memberShares = D(ledger.shares);
      const amount = roundAmount(memberShares.times(perShare));
      const nextCash = roundAmount(D(ledger.cash).plus(amount));

      db.prepare(
        `
        INSERT INTO transaction_details
        (id, trans_id, member_id, shares, amount, commission, tax, net_cash, cost_adjust, realized_profit)
        VALUES
        (?, ?, ?, '0', ?, '0', '0', ?, '0', '0')
        `,
      ).run(id(), transId, memberId, amount.toString(), amount.toString());

      insertLedgerSnapshot(db, {
        memberId,
        asOfTime: transTime,
        cash: nextCash.toString(),
        shares: ledger.shares,
        cost: ledger.cost,
        avgPrice: ledger.avg_price,
        realizedProfit: ledger.realized_profit,
        eventId: transId,
      });
    });

    insertAccountSnapshot(db, transTime, transId);
    validateConservation(db);
  });

  tx();
};

export const reverseTransaction = (request: ReverseTransactionRequest): void => {
  const db = getDatabase();
  const reverseTime = request.reverseTime || nowIso();

  const tx = db.transaction(() => {
    const original = db
      .prepare(
        `
        SELECT id, trans_time, type, price, total_shares, total_amount, total_commission, total_tax, status
        FROM transactions
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(request.transId) as
      | {
        id: string;
        trans_time: string;
        type: 'buy' | 'sell' | 'dividend' | 'reversal';
        price: string;
        total_shares: string;
        total_amount: string;
        total_commission: string;
        total_tax: string;
        status: 'confirmed' | 'reversed';
      }
      | undefined;

    if (!original) {
      throw new Error('待冲销交易不存在');
    }

    if (original.status === 'reversed') {
      throw new Error('该交易已被冲销');
    }

    if (original.type === 'reversal') {
      throw new Error('不允许冲销冲销交易');
    }

    const originalDetails = db
      .prepare(
        `
        SELECT id, trans_id, member_id, shares, amount, commission, tax, net_cash, cost_adjust, realized_profit
        FROM transaction_details
        WHERE trans_id = ?
        ORDER BY created_at ASC
        `,
      )
      .all(request.transId) as Array<{
      id: string;
      trans_id: string;
      member_id: string;
      shares: string;
      amount: string;
      commission: string;
      tax: string;
      net_cash: string;
      cost_adjust: string;
      realized_profit: string;
    }>;

    if (!originalDetails.length) {
      throw new Error('待冲销交易没有可用明细');
    }

    const reversalId = id();

    db.prepare(
      `
      INSERT INTO transactions
      (id, trans_time, type, price, total_shares, total_amount, total_commission, total_tax, status)
      VALUES
      (?, ?, 'reversal', ?, ?, ?, ?, ?, 'confirmed')
      `,
    ).run(
      reversalId,
      reverseTime,
      original.price,
      roundShares(D(0).minus(original.total_shares)).toString(),
      roundAmount(D(0).minus(original.total_amount)).toString(),
      roundAmount(D(0).minus(original.total_commission)).toString(),
      roundAmount(D(0).minus(original.total_tax)).toString(),
    );

    originalDetails.forEach((detail) => {
      const ledger = getLatestLedgerByMember(db, detail.member_id);

      const reverseShares = roundShares(D(0).minus(detail.shares));
      const reverseAmount = roundAmount(D(0).minus(detail.amount));
      const reverseCommission = roundAmount(D(0).minus(detail.commission));
      const reverseTax = roundAmount(D(0).minus(detail.tax));
      const reverseNetCash = roundAmount(D(0).minus(detail.net_cash));
      const reverseCostAdjust = roundAmount(D(0).minus(detail.cost_adjust));
      const reverseRealizedProfit = roundAmount(D(0).minus(detail.realized_profit));

      const nextShares = roundShares(D(ledger.shares).plus(reverseShares));
      const nextCash = roundAmount(D(ledger.cash).plus(reverseNetCash));
      const nextCost = roundAmount(D(ledger.cost).plus(reverseCostAdjust));
      const nextRealizedProfit = roundAmount(D(ledger.realized_profit).plus(reverseRealizedProfit));

      if (nextShares.lessThan(0)) {
        throw new Error(`冲销失败：成员 ${detail.member_id} 当前持股不足以回滚`);
      }
      if (nextCash.lessThan(0)) {
        throw new Error(`冲销失败：成员 ${detail.member_id} 当前现金不足以回滚`);
      }
      if (nextCost.lessThan(0)) {
        throw new Error(`冲销失败：成员 ${detail.member_id} 当前成本不足以回滚`);
      }

      const nextAvgPrice = nextShares.greaterThan(0)
        ? roundAvgPrice(nextCost.div(nextShares))
        : D(0);

      db.prepare(
        `
        INSERT INTO transaction_details
        (id, trans_id, member_id, shares, amount, commission, tax, net_cash, cost_adjust, realized_profit)
        VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        id(),
        reversalId,
        detail.member_id,
        reverseShares.toString(),
        reverseAmount.toString(),
        reverseCommission.toString(),
        reverseTax.toString(),
        reverseNetCash.toString(),
        reverseCostAdjust.toString(),
        reverseRealizedProfit.toString(),
      );

      insertLedgerSnapshot(db, {
        memberId: detail.member_id,
        asOfTime: reverseTime,
        cash: nextCash.toString(),
        shares: nextShares.toString(),
        cost: nextCost.toString(),
        avgPrice: nextAvgPrice.toString(),
        realizedProfit: nextRealizedProfit.toString(),
        eventId: reversalId,
      });
    });

    db.prepare('UPDATE transactions SET status = ? WHERE id = ?').run('reversed', original.id);
    insertAccountSnapshot(db, reverseTime, reversalId);
    validateConservation(db);
  });

  tx();
};
