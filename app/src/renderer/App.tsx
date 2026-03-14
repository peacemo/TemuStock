import { FormEvent, useEffect, useMemo, useState } from 'react';

import type {
  BuyParticipantInput,
  HistoricalSnapshot,
  MemberWithLedger,
  ReplayValidationResult,
  SellParticipantInput,
  TransactionDetailRecord,
  TransactionRecord,
} from '../shared/types';

const nowIsoLocal = (): string => new Date().toISOString();

export const App = () => {
  const [members, setMembers] = useState<MemberWithLedger[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [transactionDetails, setTransactionDetails] = useState<TransactionDetailRecord[]>([]);
  const [publicCash, setPublicCash] = useState('0');
  const [publicShares, setPublicShares] = useState('0');
  const [message, setMessage] = useState('就绪');

  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberCash, setNewMemberCash] = useState('10000');
  const [newMemberImmediateBuy, setNewMemberImmediateBuy] = useState(false);
  const [newMemberBuyAmount, setNewMemberBuyAmount] = useState('0');
  const [newMemberBuyPrice, setNewMemberBuyPrice] = useState('10.000');

  const [buyPrice, setBuyPrice] = useState('10.000');
  const [buyParticipants, setBuyParticipants] = useState<BuyParticipantInput[]>([]);

  const [sellPrice, setSellPrice] = useState('10.000');
  const [sellParticipants, setSellParticipants] = useState<SellParticipantInput[]>([]);

  const [dividendPerShare, setDividendPerShare] = useState('0.5');
  const [historyQueryTime, setHistoryQueryTime] = useState('');
  const [historySnapshot, setHistorySnapshot] = useState<HistoricalSnapshot | null>(null);
  const [reverseTransId, setReverseTransId] = useState('');
  const [replayResult, setReplayResult] = useState<ReplayValidationResult | null>(null);

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members],
  );

  const refresh = async () => {
    const [membersResult, accountResult, transactionsResult, transactionDetailsResult] = await Promise.all([
      window.desktopApi.listMembers(),
      window.desktopApi.getPublicAccount(),
      window.desktopApi.listTransactions(),
      window.desktopApi.listTransactionDetails(),
    ]);

    if (membersResult.ok && membersResult.data) {
      setMembers(membersResult.data);
    }

    if (accountResult.ok && accountResult.data) {
      setPublicCash(accountResult.data.totalCash);
      setPublicShares(accountResult.data.totalShares);
    } else {
      setPublicCash('0');
      setPublicShares('0');
    }

    if (transactionsResult.ok && transactionsResult.data) {
      setTransactions(transactionsResult.data);
    }

    if (transactionDetailsResult.ok && transactionDetailsResult.data) {
      setTransactionDetails(transactionDetailsResult.data);
    }
  };

  useEffect(() => {
    refresh().catch((error) => {
      setMessage(error instanceof Error ? error.message : '加载数据失败');
    });
  }, []);

  useEffect(() => {
    if (!activeMembers.length) {
      setBuyParticipants([]);
      setSellParticipants([]);
      return;
    }

    setBuyParticipants((previous) => {
      if (previous.length > 0) {
        return previous;
      }
      return [{ memberId: activeMembers[0].id, amount: '1000' }];
    });

    setSellParticipants((previous) => {
      if (previous.length > 0) {
        return previous;
      }
      return [{ memberId: activeMembers[0].id, shares: '10' }];
    });
  }, [activeMembers]);

  const addBuyParticipant = () => {
    if (!activeMembers.length) {
      return;
    }
    setBuyParticipants((previous) => [...previous, { memberId: activeMembers[0].id, amount: '0' }]);
  };

  const removeBuyParticipant = (index: number) => {
    setBuyParticipants((previous) => previous.filter((_participant, rowIndex) => rowIndex !== index));
  };

  const updateBuyParticipant = (index: number, patch: Partial<BuyParticipantInput>) => {
    setBuyParticipants((previous) => previous.map((participant, rowIndex) => (
      rowIndex === index ? { ...participant, ...patch } : participant
    )));
  };

  const addSellParticipant = () => {
    if (!activeMembers.length) {
      return;
    }
    setSellParticipants((previous) => [...previous, { memberId: activeMembers[0].id, shares: '0' }]);
  };

  const removeSellParticipant = (index: number) => {
    setSellParticipants((previous) => previous.filter((_participant, rowIndex) => rowIndex !== index));
  };

  const updateSellParticipant = (index: number, patch: Partial<SellParticipantInput>) => {
    setSellParticipants((previous) => previous.map((participant, rowIndex) => (
      rowIndex === index ? { ...participant, ...patch } : participant
    )));
  };

  const createMember = async (event: FormEvent) => {
    event.preventDefault();
    const result = await window.desktopApi.createMember({
      name: newMemberName,
      joinDate: nowIsoLocal(),
      initialCash: newMemberCash,
      immediateBuyAmount: newMemberImmediateBuy ? newMemberBuyAmount : undefined,
      immediateBuyPrice: newMemberImmediateBuy ? newMemberBuyPrice : undefined,
    });

    if (!result.ok) {
      setMessage(result.error ?? '创建成员失败');
      return;
    }

    setNewMemberName('');
    setNewMemberImmediateBuy(false);
    setNewMemberBuyAmount('0');
    setMessage('成员创建成功');
    await refresh();
  };

  const submitBuy = async (event: FormEvent) => {
    event.preventDefault();

    if (!buyParticipants.length) {
      setMessage('买入参与人不能为空');
      return;
    }

    const result = await window.desktopApi.executeBuy({
      transTime: nowIsoLocal(),
      price: buyPrice,
      participants: buyParticipants,
    });

    if (!result.ok) {
      setMessage(result.error ?? '买入失败');
      return;
    }

    setMessage('买入成功');
    await refresh();
  };

  const submitSell = async (event: FormEvent) => {
    event.preventDefault();

    if (!sellParticipants.length) {
      setMessage('卖出参与人不能为空');
      return;
    }

    const result = await window.desktopApi.executeSell({
      transTime: nowIsoLocal(),
      price: sellPrice,
      participants: sellParticipants,
    });

    if (!result.ok) {
      setMessage(result.error ?? '卖出失败');
      return;
    }

    setMessage('卖出成功');
    await refresh();
  };

  const submitDividend = async (event: FormEvent) => {
    event.preventDefault();
    const result = await window.desktopApi.executeDividend({
      transTime: nowIsoLocal(),
      perShareDividend: dividendPerShare,
    });

    if (!result.ok) {
      setMessage(result.error ?? '分红失败');
      return;
    }

    setMessage('分红处理成功');
    await refresh();
  };

  const queryHistoricalSnapshot = async (event: FormEvent) => {
    event.preventDefault();

    if (!historyQueryTime) {
      setMessage('请先输入历史查询时间');
      return;
    }

    const result = await window.desktopApi.getHistoricalSnapshot({
      asOfTime: new Date(historyQueryTime).toISOString(),
    });

    if (!result.ok || !result.data) {
      setMessage(result.error ?? '历史快照查询失败');
      return;
    }

    setHistorySnapshot(result.data);
    setMessage('历史快照查询成功');
  };

  const submitReverseTransaction = async (event: FormEvent) => {
    event.preventDefault();

    if (!reverseTransId) {
      setMessage('请先输入待冲销交易ID');
      return;
    }

    const result = await window.desktopApi.reverseTransaction({
      transId: reverseTransId,
      reverseTime: nowIsoLocal(),
    });

    if (!result.ok) {
      setMessage(result.error ?? '冲销失败');
      return;
    }

    setMessage('冲销成功');
    setReverseTransId('');
    await refresh();
  };

  const runReplayValidation = async () => {
    const result = await window.desktopApi.validateReplay();
    if (!result.ok || !result.data) {
      setMessage(result.error ?? '重放校验失败');
      return;
    }

    setReplayResult(result.data);
    setMessage(result.data.ok ? '历史重放校验通过' : '历史重放校验发现异常');
  };

  return (
    <div className="page">
      <header className="header">
        <h1>TemuStock 多人合资记账</h1>
        <p>状态：{message}</p>
      </header>

      <section className="card">
        <h2>公共账户</h2>
        <div className="grid2">
          <div>总现金：{publicCash}</div>
          <div>总持股：{publicShares}</div>
        </div>
      </section>

      <section className="card">
        <h2>新增成员</h2>
        <form className="form" onSubmit={createMember}>
          <label className="field">
            <span className="field-title">成员名称</span>
            <input
              value={newMemberName}
              onChange={(event) => setNewMemberName(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field-title">初始资金</span>
            <input
              value={newMemberCash}
              onChange={(event) => setNewMemberCash(event.target.value)}
              required
            />
          </label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={newMemberImmediateBuy}
              onChange={(event) => setNewMemberImmediateBuy(event.target.checked)}
            />
            加入后立即买入
          </label>

          {newMemberImmediateBuy && (
            <>
              <label className="field">
                <span className="field-title">立即买入金额</span>
                <input
                  value={newMemberBuyAmount}
                  onChange={(event) => setNewMemberBuyAmount(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span className="field-title">立即买入价格</span>
                <input
                  value={newMemberBuyPrice}
                  onChange={(event) => setNewMemberBuyPrice(event.target.value)}
                  required
                />
              </label>
            </>
          )}
          <button type="submit">创建成员</button>
        </form>
      </section>

      <section className="card">
        <h2>买入</h2>
        <form className="form" onSubmit={submitBuy}>
          <label className="field">
            <span className="field-title">买入价格</span>
            <input
              value={buyPrice}
              onChange={(event) => setBuyPrice(event.target.value)}
              required
            />
          </label>
          <button type="button" onClick={addBuyParticipant}>添加参与人</button>
          <button type="submit">提交多人买入</button>
          <div className="spacer" />

          {buyParticipants.map((participant, index) => (
            <div className="participant-row" key={`buy-${index}`}>
              <label className="field">
                <span className="field-title">成员</span>
                <select
                  value={participant.memberId}
                  onChange={(event) => updateBuyParticipant(index, { memberId: event.target.value })}
                >
                  {activeMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-title">投入金额</span>
                <input
                  value={participant.amount}
                  onChange={(event) => updateBuyParticipant(index, { amount: event.target.value })}
                  required
                />
              </label>
              <button type="button" className="danger" onClick={() => removeBuyParticipant(index)}>
                移除
              </button>
            </div>
          ))}
        </form>
      </section>

      <section className="card">
        <h2>卖出</h2>
        <form className="form" onSubmit={submitSell}>
          <label className="field">
            <span className="field-title">卖出价格</span>
            <input
              value={sellPrice}
              onChange={(event) => setSellPrice(event.target.value)}
              required
            />
          </label>
          <button type="button" onClick={addSellParticipant}>添加参与人</button>
          <button type="submit">提交多人卖出</button>
          <div className="spacer" />

          {sellParticipants.map((participant, index) => (
            <div className="participant-row" key={`sell-${index}`}>
              <label className="field">
                <span className="field-title">成员</span>
                <select
                  value={participant.memberId}
                  onChange={(event) => updateSellParticipant(index, { memberId: event.target.value })}
                >
                  {activeMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-title">卖出股数</span>
                <input
                  value={participant.shares}
                  onChange={(event) => updateSellParticipant(index, { shares: event.target.value })}
                  required
                />
              </label>
              <button type="button" className="danger" onClick={() => removeSellParticipant(index)}>
                移除
              </button>
            </div>
          ))}
        </form>
      </section>

      <section className="card">
        <h2>分红</h2>
        <form className="form" onSubmit={submitDividend}>
          <label className="field">
            <span className="field-title">每股分红</span>
            <input
              value={dividendPerShare}
              onChange={(event) => setDividendPerShare(event.target.value)}
              required
            />
          </label>
          <button type="submit">执行分红</button>
        </form>
      </section>

      <section className="card">
        <h2>成员账本</h2>
        <table>
          <thead>
            <tr>
              <th>成员</th>
              <th>现金</th>
              <th>持股</th>
              <th>成本</th>
              <th>均价</th>
              <th>已实现盈亏</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.ledger.cash}</td>
                <td>{member.ledger.shares}</td>
                <td>{member.ledger.cost}</td>
                <td>{member.ledger.avgPrice}</td>
                <td>{member.ledger.realizedProfit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>交易历史</h2>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>价格/分红</th>
              <th>总股数</th>
              <th>总金额</th>
              <th>佣金</th>
              <th>税费</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((trans) => (
              <tr key={trans.id}>
                <td>{new Date(trans.transTime).toLocaleString()}</td>
                <td>{trans.type}</td>
                <td>{trans.price}</td>
                <td>{trans.totalShares}</td>
                <td>{trans.totalAmount}</td>
                <td>{trans.totalCommission}</td>
                <td>{trans.totalTax}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>交易明细（审计）</h2>
        <table>
          <thead>
            <tr>
              <th>交易ID</th>
              <th>成员</th>
              <th>股数变动</th>
              <th>金额</th>
              <th>佣金</th>
              <th>税费</th>
              <th>净现金</th>
              <th>成本调整</th>
              <th>已实现盈亏</th>
            </tr>
          </thead>
          <tbody>
            {transactionDetails.map((detail) => (
              <tr key={detail.id}>
                <td>{detail.transId.slice(0, 8)}</td>
                <td>{detail.memberName}</td>
                <td>{detail.shares}</td>
                <td>{detail.amount}</td>
                <td>{detail.commission}</td>
                <td>{detail.tax}</td>
                <td>{detail.netCash}</td>
                <td>{detail.costAdjust}</td>
                <td>{detail.realizedProfit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>历史快照回溯</h2>
        <form className="form" onSubmit={queryHistoricalSnapshot}>
          <label className="field">
            <span className="field-title">查询时间</span>
            <input
              type="datetime-local"
              value={historyQueryTime}
              onChange={(event) => setHistoryQueryTime(event.target.value)}
              required
            />
          </label>
          <button type="submit">查询时间点快照</button>
        </form>

        {historySnapshot && (
          <div className="history-wrap">
            <p>
              快照时间：{new Date(historySnapshot.asOfTime).toLocaleString()}，总现金：{historySnapshot.publicAccount.totalCash}，总持股：{historySnapshot.publicAccount.totalShares}
            </p>
            <table>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>现金</th>
                  <th>持股</th>
                  <th>成本</th>
                  <th>均价</th>
                  <th>已实现盈亏</th>
                </tr>
              </thead>
              <tbody>
                {historySnapshot.members.map((member) => (
                  <tr key={`history-${member.id}`}>
                    <td>{member.name}</td>
                    <td>{member.ledger.cash}</td>
                    <td>{member.ledger.shares}</td>
                    <td>{member.ledger.cost}</td>
                    <td>{member.ledger.avgPrice}</td>
                    <td>{member.ledger.realizedProfit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>反向交易冲销</h2>
        <form className="form" onSubmit={submitReverseTransaction}>
          <label className="field">
            <span className="field-title">交易ID（可从交易明细复制）</span>
            <input
              value={reverseTransId}
              onChange={(event) => setReverseTransId(event.target.value)}
              required
            />
          </label>
          <button type="submit">执行冲销</button>
        </form>
      </section>

      <section className="card">
        <h2>历史重放校验</h2>
        <button type="button" onClick={runReplayValidation}>执行重放校验</button>
        {replayResult && (
          <div className="history-wrap">
            <p>
              校验结果：{replayResult.ok ? '通过' : '失败'}；检查快照数：{replayResult.checkedSnapshots}；异常快照数：{replayResult.failedSnapshots}
            </p>
            {!replayResult.ok && (
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>预期现金</th>
                    <th>实际现金</th>
                    <th>预期持股</th>
                    <th>实际持股</th>
                  </tr>
                </thead>
                <tbody>
                  {replayResult.failures.map((failure) => (
                    <tr key={failure.asOfTime}>
                      <td>{new Date(failure.asOfTime).toLocaleString()}</td>
                      <td>{failure.expectedCash}</td>
                      <td>{failure.actualCash}</td>
                      <td>{failure.expectedShares}</td>
                      <td>{failure.actualShares}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
