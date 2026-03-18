import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'info' | 'error';

type SettlementLogEntry = {
  timestamp: string;
  level: LogLevel;
  category: 'settlement';
  event: string;
  runId: string;
  data: unknown;
};

const LOG_DIR_NAME = 'logs';
const LOG_SUBDIR_NAME = 'settlement';
const LOG_FILE_PREFIX = 'settlement-';
const LOG_FILE_EXT = '.jsonl';
const RETENTION_DAYS = 30;

let settlementLogDir: string | null = null;
let runId: string = crypto.randomUUID();

const nowIso = (): string => new Date().toISOString();

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const currentLogFilePath = (): string | null => {
  if (!settlementLogDir) {
    return null;
  }

  const datePart = formatDate(new Date());
  return path.join(settlementLogDir, `${LOG_FILE_PREFIX}${datePart}${LOG_FILE_EXT}`);
};

const writeEntry = (entry: SettlementLogEntry): void => {
  const filePath = currentLogFilePath();
  if (!filePath) {
    return;
  }

  try {
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write settlement log:', error);
  }
};

const pruneOldLogs = (logDir: string): void => {
  const cutoffTime = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const files = fs.readdirSync(logDir);
  files.forEach((fileName) => {
    if (!fileName.startsWith(LOG_FILE_PREFIX) || !fileName.endsWith(LOG_FILE_EXT)) {
      return;
    }

    const filePath = path.join(logDir, fileName);
    const stats = fs.statSync(filePath);
    if (stats.mtimeMs < cutoffTime) {
      fs.rmSync(filePath, { force: true });
    }
  });
};

export const initializeSettlementLogger = (userDataPath: string): void => {
  settlementLogDir = path.join(userDataPath, LOG_DIR_NAME, LOG_SUBDIR_NAME);
  runId = crypto.randomUUID();

  fs.mkdirSync(settlementLogDir, { recursive: true });
  pruneOldLogs(settlementLogDir);

  writeEntry({
    timestamp: nowIso(),
    level: 'info',
    category: 'settlement',
    event: 'app.startup',
    runId,
    data: {
      platform: process.platform,
      pid: process.pid,
      logDir: settlementLogDir,
      retentionDays: RETENTION_DAYS,
    },
  });
};

export const logSettlement = (event: string, data: unknown): void => {
  writeEntry({
    timestamp: nowIso(),
    level: 'info',
    category: 'settlement',
    event,
    runId,
    data,
  });
};

export const logSettlementError = (event: string, data: unknown): void => {
  writeEntry({
    timestamp: nowIso(),
    level: 'error',
    category: 'settlement',
    event,
    runId,
    data,
  });
};
