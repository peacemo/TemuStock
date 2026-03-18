import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import os from 'node:os';
import started from 'electron-squirrel-startup';

import { initializeDatabase } from './database';
import { registerIpcHandlers } from './ipc/handlers';
import { initializeSettlementLogger } from './logging/settlement-logger';

if (started) {
  app.quit();
}

app.setPath('userData', path.join(os.homedir(), '.config', 'temustock'));

const getWindowIconPath = () => {
  const iconRelativePath = path.join('assets', 'icons', 'generated', 'png', '512x512.png');

  if (app.isPackaged) {
    return path.join(process.resourcesPath, iconRelativePath);
  }

  return path.resolve(__dirname, '../../', iconRelativePath);
};

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    icon: process.platform === 'linux' ? getWindowIconPath() : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.on('ready', () => {
  Menu.setApplicationMenu(null);
  const userDataPath = app.getPath('userData');
  initializeSettlementLogger(userDataPath);
  initializeDatabase(userDataPath);
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
