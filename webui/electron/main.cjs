const { app, BrowserWindow, Menu, globalShortcut } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

Menu.setApplicationMenu(null);

let mainWindow = null;
const CANDIDATE_PORTS = [5173, 5174, 5175];

function pingPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 304);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findActiveViteUrl(maxWaitMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    for (const port of CANDIDATE_PORTS) {
      if (await pingPort(port)) {
        return `http://localhost:${port}`;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return 'http://localhost:5173';
}

function getDaemonAuth() {
  try {
    const listenFile = path.join(os.homedir(), '.jeikcode', 'webui-listen.json');
    if (fs.existsSync(listenFile)) {
      const data = JSON.parse(fs.readFileSync(listenFile, 'utf8'));
      if (data && data.token) {
        return data;
      }
    }
  } catch {}
  return null;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'JeikCode Developer Studio',
    backgroundColor: '#131314',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    },
  });

  const targetUrl = await findActiveViteUrl();
  const daemonAuth = getDaemonAuth();
  const finalUrl = daemonAuth && daemonAuth.token
    ? `${targetUrl}/?token=${encodeURIComponent(daemonAuth.token)}`
    : targetUrl;
  await mainWindow.loadURL(finalUrl).catch(() => {});
  mainWindow.show();

  // 支持 F12 或 Ctrl+Shift+I 呼出控制台方便二开调试
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

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
