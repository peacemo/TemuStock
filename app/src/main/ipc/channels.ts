export const IPC_CHANNELS = {
  createMember: 'member:create',
  listMembers: 'member:list',
  executeBuy: 'transaction:buy',
  executeSell: 'transaction:sell',
  executeDividend: 'transaction:dividend',
  reverseTransaction: 'transaction:reverse',
  listTransactions: 'transaction:list',
  listTransactionDetails: 'transaction:details',
  getPublicAccount: 'account:latest',
  getHistoricalSnapshot: 'account:history-snapshot',
  validateReplay: 'account:validate-replay',
} as const;
