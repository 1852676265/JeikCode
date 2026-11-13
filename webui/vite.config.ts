import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { mockApiPlugin } from './mock-server';

function stripVersionPrefix(raw: string): string {
  return raw.trim().replace(/^v/i, '');
}

/**
 * WebUI 编译期版本注入。优先级：
 * 1. `JEIKCODE_VERSION` / `GITHUB_REF_NAME`（CI 打 Tag 发版时注入，例如 v7.0.13）；
 * 2. `Cargo.toml` `[workspace.package].version`（本地开发）。
 *
 * 注意：工作区 Cargo.toml 不一定跟 Tag 走（发版流水线只在
 * Rust job 里临时 sed），所以打 Tag 时必须走 env，否则侧栏会烘上一次手改的旧号。
 */
function getAppVersion(): string {
  const fromEnv = process.env.JEIKCODE_VERSION || process.env.GITHUB_REF_NAME;
  if (fromEnv && fromEnv.trim()) {
    return stripVersionPrefix(fromEnv);
  }
  try {
    const cargoTomlPath = path.resolve(__dirname, '../Cargo.toml');
    const tomlContent = fs.readFileSync(cargoTomlPath, 'utf8');
    const match = tomlContent.match(/\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/);
    if (match && match[1]) {
      return stripVersionPrefix(match[1]);
    }
  } catch {}
  return '0.0.0';
}

function getDaemonAuth(): { port: number; token?: string } | null {
  try {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    let listenFile = path.resolve(home, '.zap', 'webui-listen.json');
    if (!fs.existsSync(listenFile)) {
      listenFile = path.resolve(home, '.jeikcode', 'webui-listen.json');
    }
    if (fs.existsSync(listenFile)) {
      const data = JSON.parse(fs.readFileSync(listenFile, 'utf8'));
      if (data && data.port) {
        return { port: Number(data.port), token: data.token };
      }
    }
  } catch {}
  return null;
}

function autoAuthPlugin(): Plugin {
  return {
    name: 'vite-plugin-auto-auth',
    transformIndexHtml(html) {
      const auth = getDaemonAuth();
      if (auth?.token) {
        return html.replace(
          '<head>',
          `<head><script>try{sessionStorage.setItem('zap_webui_token',${JSON.stringify(auth.token)});sessionStorage.setItem('jeikcode_webui_token',${JSON.stringify(auth.token)});}catch(e){}</script>`
        );
      }
      return html;
    },
  };
}

function parseTaskFolder(taskDirPath: string, fallbackYear: string) {
  const dirName = path.basename(taskDirPath);
  const metaFilePath = path.join(taskDirPath, 'task.json');
  let meta: any = null;
  if (fs.existsSync(metaFilePath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaFilePath, 'utf-8'));
    } catch (e) {}
  }
  let stats: any = null;
  try { stats = fs.statSync(taskDirPath); } catch (e) {}
  if (!meta) {
    meta = {
      id: dirName,
      title: dirName,
      status: 'developing',
      project: '常规项目',
      createdAt: stats ? stats.birthtime.toISOString() : new Date().toISOString(),
      sqlReleaseRecords: {},
    };
  }
  const sqlDirPath = path.join(taskDirPath, 'sql');
  let sqlCount = 0;
  let prodPendingCount = 0;
  let testPendingCount = 0;
  if (fs.existsSync(sqlDirPath)) {
    try {
      const sqlFiles = fs.readdirSync(sqlDirPath).filter((f) => f.endsWith('.sql'));
      sqlCount = sqlFiles.length;
      const records = meta.sqlReleaseRecords || {};
      for (const file of sqlFiles) {
        const r = records[file] || {};
        if (!r.testReleased) testPendingCount++;
        if (!r.prodReleased) prodPendingCount++;
      }
    } catch (e) {}
  }
  let inferredYear = meta.year || fallbackYear;
  if (!inferredYear) {
    const createDate = new Date(meta.createdAt || Date.now());
    inferredYear = createDate.getFullYear().toString();
  }
  return {
    ...meta,
    title: meta.title || dirName,
    dirName,
    fullPath: taskDirPath,
    year: inferredYear,
    sqlCount,
    testPendingCount,
    prodPendingCount,
  };
}

/**
 * 本地插件包静态资源动态服务与本地数据 RPC 插件
 * 允许外部插件（如 DevOrbit 等独立项目产物）直接读取并同步本地真实工作区数据与文件
 */
function localPluginsServePlugin(): Plugin {
  return {
    name: 'vite-plugin-local-plugins-serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';

        // 1. 本地插件文件系统 RPC 接口
        if (url.startsWith('/api/plugins-rpc/dev-orbit') && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const { action, payload = {} } = body;
              const ws = payload.workspacePath || 'D:/工作';

              if (action === 'get-workspace-path') {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ workspacePath: ws }));
                return;
              }

              if (action === 'get-tasks') {
                if (!fs.existsSync(ws)) {
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ tasks: [], years: [] }));
                  return;
                }

                const entries = fs.readdirSync(ws, { withFileTypes: true });
                const tasks: any[] = [];
                const yearSet = new Set<string>();

                for (const entry of entries) {
                  if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
                  const subPath = path.join(ws, entry.name);
                  if (/^\d{4}$/.test(entry.name)) {
                    yearSet.add(entry.name);
                    try {
                      const yearEntries = fs.readdirSync(subPath, { withFileTypes: true });
                      for (const yEntry of yearEntries) {
                        if (yEntry.isDirectory() && !yEntry.name.startsWith('_') && !yEntry.name.startsWith('.')) {
                          const taskDirPath = path.join(subPath, yEntry.name);
                          const taskObj = parseTaskFolder(taskDirPath, entry.name);
                          if (taskObj) tasks.push(taskObj);
                        }
                      }
                    } catch (e) {}
                  } else {
                    const hasTaskJson = fs.existsSync(path.join(subPath, 'task.json'));
                    if (hasTaskJson) {
                      const taskObj = parseTaskFolder(subPath, '');
                      if (taskObj) {
                        tasks.push(taskObj);
                        if (taskObj.year) yearSet.add(taskObj.year);
                      }
                    }
                  }
                }

                const currentYear = new Date().getFullYear().toString();
                yearSet.add(currentYear);
                const sortedYears = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
                tasks.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ tasks, years: sortedYears }));
                return;
              }

              if (action === 'get-task-sqls') {
                const taskDir = payload.taskDir;
                if (!taskDir || !fs.existsSync(taskDir)) {
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify([]));
                  return;
                }
                const sqlDir = path.join(taskDir, 'sql');
                const metaPath = path.join(taskDir, 'task.json');
                let meta: any = {};
                if (fs.existsSync(metaPath)) {
                  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) {}
                }
                const records = meta.sqlReleaseRecords || {};
                if (!fs.existsSync(sqlDir)) {
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify([]));
                  return;
                }
                const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql'));
                const result = files.map((file) => {
                  const filePath = path.join(sqlDir, file);
                  const st = fs.statSync(filePath);
                  const rec = records[file] || {};
                  return {
                    fileName: file,
                    filePath,
                    size: st.size,
                    updatedAt: st.mtime.toISOString(),
                    testReleased: Boolean(rec.testReleased),
                    testReleasedAt: rec.testReleasedAt || null,
                    prodReleased: Boolean(rec.prodReleased),
                    prodReleasedAt: rec.prodReleasedAt || null,
                  };
                });
                result.sort((a, b) => a.fileName.localeCompare(b.fileName));
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(result));
                return;
              }

              if (action === 'get-task-notes') {
                const taskDir = payload.taskDir;
                let notes: any[] = [];
                if (taskDir) {
                  const metaPath = path.join(taskDir, 'task.json');
                  if (fs.existsSync(metaPath)) {
                    try {
                      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                      notes = meta.notes || [];
                    } catch (e) {}
                  }
                }
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(notes));
                return;
              }

              if (action === 'get-task-file') {
                const taskDir = payload.taskDir;
                let content = '';
                if (taskDir) {
                  const docsDir = path.join(taskDir, 'docs');
                  if (payload.type === 'note') {
                    const noteFile = path.join(docsDir, '笔记.md');
                    if (fs.existsSync(noteFile)) content = fs.readFileSync(noteFile, 'utf-8');
                  } else if (payload.type === 'requirement') {
                    const reqFile = path.join(docsDir, '需求.md');
                    if (fs.existsSync(reqFile)) content = fs.readFileSync(reqFile, 'utf-8');
                  }
                }
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ content }));
                return;
              }

              if (action === 'get-dir-files') {
                const dirPath = payload.dirPath;
                if (!dirPath || !fs.existsSync(dirPath)) {
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify([]));
                  return;
                }
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const docs = entries
                  .filter((e) => e.isFile() && !e.name.startsWith('.'))
                  .map((e) => {
                    const full = path.join(dirPath, e.name);
                    const st = fs.statSync(full);
                    return {
                      fileName: e.name,
                      filePath: full,
                      size: st.size,
                      updatedAt: st.mtime.toLocaleString(),
                    };
                  });
                docs.sort((a, b) => a.fileName.localeCompare(b.fileName));
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(docs));
                return;
              }

              if (action === 'read-sql-content') {
                const filePath = payload.filePath;
                let content = '';
                if (filePath && fs.existsSync(filePath)) {
                  content = fs.readFileSync(filePath, 'utf-8');
                }
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ content }));
                return;
              }

              if (action === 'update-sql-status') {
                const { taskDir, fileName, env, status, timestamp } = payload;
                if (taskDir && fileName) {
                  const metaPath = path.join(taskDir, 'task.json');
                  let meta: any = { sqlReleaseRecords: {} };
                  if (fs.existsSync(metaPath)) {
                    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) {}
                  }
                  if (!meta.sqlReleaseRecords) meta.sqlReleaseRecords = {};
                  if (!meta.sqlReleaseRecords[fileName]) meta.sqlReleaseRecords[fileName] = {};
                  const isReleased = Boolean(status === true || status === 'published');
                  if (env === 'test') {
                    meta.sqlReleaseRecords[fileName].testReleased = isReleased;
                    meta.sqlReleaseRecords[fileName].testReleasedAt = isReleased ? (timestamp || new Date().toLocaleString()) : null;
                  } else if (env === 'prod') {
                    meta.sqlReleaseRecords[fileName].prodReleased = isReleased;
                    meta.sqlReleaseRecords[fileName].prodReleasedAt = isReleased ? (timestamp || new Date().toLocaleString()) : null;
                  }
                  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ success: true, record: meta.sqlReleaseRecords[fileName] }));
                  return;
                }
              }

              if (action === 'open-in-explorer') {
                const targetPath = payload.targetPath || payload.workspacePath || 'D:/工作';
                if (targetPath) {
                  const cp = await import('child_process');
                  cp.exec(`explorer.exe "${targetPath.replace(/\//g, '\\')}"`);
                }
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true }));
                return;
              }

              const appData = process.env.APPDATA || '';
              const devOrbitConfigPath = path.join(appData, 'dev-orbit', 'devorbit_config.json');
              const legacyConfigPath = path.join(appData, 'dev-task-hub', 'devtaskhub_config.json');

              const getResolvedConfigPath = () => {
                if (fs.existsSync(devOrbitConfigPath)) return devOrbitConfigPath;
                if (fs.existsSync(legacyConfigPath)) return legacyConfigPath;
                return devOrbitConfigPath;
              };

              const readQuickNotesFile = (wsDir: string, fileName: string, defaultVal: any) => {
                const target = path.join(wsDir || 'D:/工作', '_quick_notes', fileName);
                if (fs.existsSync(target)) {
                  try {
                    let raw = fs.readFileSync(target, 'utf-8');
                    if (raw && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
                    return JSON.parse(raw);
                  } catch (e) {}
                }
                return defaultVal;
              };

              const writeQuickNotesFile = (wsDir: string, fileName: string, data: any) => {
                const target = path.join(wsDir || 'D:/工作', '_quick_notes', fileName);
                const parentDir = path.dirname(target);
                if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
                fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf-8');
                return true;
              };

              if (action === 'get-app-config') {
                const cPath = getResolvedConfigPath();
                let cfg: any = {};
                if (fs.existsSync(cPath)) {
                  try {
                    let raw = fs.readFileSync(cPath, 'utf-8');
                    if (raw && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
                    cfg = JSON.parse(raw);
                  } catch (e) {}
                }
                if (!cfg.workspacePath) cfg.workspacePath = 'D:\\工作';
                if (!cfg.defaultYear) cfg.defaultYear = '2026';
                if (!cfg.defaultProject) cfg.defaultProject = 'MZ';
                if (!cfg.developerName) cfg.developerName = 'LiSB';
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(cfg));
                return;
              }

              if (action === 'save-app-config') {
                const cPath = getResolvedConfigPath();
                const parentDir = path.dirname(cPath);
                if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
                let current: any = {};
                if (fs.existsSync(cPath)) {
                  try {
                    let raw = fs.readFileSync(cPath, 'utf-8');
                    if (raw && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
                    current = JSON.parse(raw);
                  } catch (e) {}
                }
                const merged = { ...current, ...payload };
                fs.writeFileSync(cPath, JSON.stringify(merged, null, 2), 'utf-8');
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(merged));
                return;
              }

              if (action === 'open-config-folder') {
                const cDir = path.join(appData, 'dev-orbit');
                if (!fs.existsSync(cDir)) fs.mkdirSync(cDir, { recursive: true });
                const cp = await import('child_process');
                cp.exec(`explorer.exe "${cDir.replace(/\//g, '\\')}"`);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true, path: cDir }));
                return;
              }

              if (action === 'select-workspace-dir') {
                const cp = await import('child_process');
                const script = `
                  Add-Type -AssemblyName System.Windows.Forms
                  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
                  $dialog.Description = '选择你的开发工作区根目录'
                  $dialog.ShowNewFolderButton = $true
                  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                      Write-Output $dialog.SelectedPath
                  }
                `;
                cp.exec(`powershell -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, (err, stdout) => {
                  const selectedPath = (stdout || '').trim();
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ workspacePath: selectedPath || null }));
                });
                return;
              }

              if (action === 'get-quick-notes') {
                const targetWs = payload.workspacePath || ws;
                const data = readQuickNotesFile(targetWs, 'notes.json', []);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(data));
                return;
              }

              if (action === 'save-quick-notes-batch') {
                const targetWs = payload.workspacePath || ws;
                writeQuickNotesFile(targetWs, 'notes.json', payload.notes || []);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true }));
                return;
              }

              if (action === 'save-quick-note') {
                const targetWs = payload.workspacePath || ws;
                const list = readQuickNotesFile(targetWs, 'notes.json', []);
                const note = payload.note || {};
                const idx = list.findIndex((n: any) => n.id === note.id);
                if (idx !== -1) list[idx] = note;
                else list.unshift(note);
                writeQuickNotesFile(targetWs, 'notes.json', list);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true }));
                return;
              }

              if (action === 'delete-quick-note') {
                const targetWs = payload.workspacePath || ws;
                let list = readQuickNotesFile(targetWs, 'notes.json', []);
                list = list.filter((n: any) => n.id !== payload.id);
                writeQuickNotesFile(targetWs, 'notes.json', list);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true }));
                return;
              }

              if (action === 'get-memos') {
                const targetWs = payload.workspacePath || ws;
                const data = readQuickNotesFile(targetWs, 'memos.json', []);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(data));
                return;
              }

              if (action === 'save-memo') {
                const targetWs = payload.workspacePath || ws;
                const list = readQuickNotesFile(targetWs, 'memos.json', []);
                const memo = payload.memo || {};
                const idx = list.findIndex((m: any) => m.id === memo.id);
                if (idx !== -1) list[idx] = memo;
                else list.unshift(memo);
                writeQuickNotesFile(targetWs, 'memos.json', list);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true }));
                return;
              }

              if (action === 'delete-memo') {
                const targetWs = payload.workspacePath || ws;
                let list = readQuickNotesFile(targetWs, 'memos.json', []);
                list = list.filter((m: any) => m.id !== payload.id);
                writeQuickNotesFile(targetWs, 'memos.json', list);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true }));
                return;
              }

              if (action === 'get-server-credentials') {
                const targetWs = payload.workspacePath || ws;
                const data = readQuickNotesFile(targetWs, 'server_credentials.json', []);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(data));
                return;
              }

              if (action === 'save-server-credentials') {
                const targetWs = payload.workspacePath || ws;
                writeQuickNotesFile(targetWs, 'server_credentials.json', payload.credentials || []);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true }));
                return;
              }

              if (action === 'get-credentials-meta') {
                const targetWs = payload.workspacePath || ws;
                const data = readQuickNotesFile(targetWs, 'credentials_meta.json', { lastSync: '刚刚' });
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(data));
                return;
              }

              if (action === 'save-credentials-meta') {
                const targetWs = payload.workspacePath || ws;
                writeQuickNotesFile(targetWs, 'credentials_meta.json', payload.meta || {});
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true }));
                return;
              }

              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ success: true }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message || 'RPC Error' }));
            }
          });
          return;
        }

        // 2. 静态页面服务
        const match = url.match(/^\/(?:plugins|plugins-local)\/([a-zA-Z0-9-_]+)(\/.*)?$/);
        if (match) {
          const pluginId = match[1];
          let subPath = (match[2] || '/index.html').replace(/^\//, '') || 'index.html';
          subPath = subPath.split('?')[0];

          // 候选路径列表：优先用户 ~/.zap/plugins/{id}/dist，其次本地 D:/Projects/{id}/dist
          const home = process.env.USERPROFILE || process.env.HOME || '';
          const candidateRoots = [
            path.resolve(home, '.zap', 'plugins', pluginId, 'dist'),
            path.resolve(home, '.zap', 'plugins', pluginId, 'web'),
            path.resolve(`D:/Projects/${pluginId}/dist`),
            path.resolve(`D:/Projects/${pluginId}`),
          ];

          for (const rootDir of candidateRoots) {
            const targetFile = path.resolve(rootDir, subPath);
            if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
              const ext = path.extname(targetFile).toLowerCase();
              const mimeTypes: Record<string, string> = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.json': 'application/json; charset=utf-8',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml',
                '.woff2': 'font/woff2',
              };
              res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
              return fs.createReadStream(targetFile).pipe(res);
            }
          }
        }
        next();
      });
    },
  };
}

async function checkPortHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 400 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findActiveDaemonPort(preferredPort?: number): Promise<number> {
  if (preferredPort && (await checkPortHealth(preferredPort))) {
    return preferredPort;
  }
  const candidatePorts = [13457, 13458, 13459, 13460, 13461, 13462];
  for (const port of candidatePorts) {
    if (port === preferredPort) continue;
    if (await checkPortHealth(port)) {
      return port;
    }
  }
  return preferredPort || 13459;
}

export default defineConfig(async () => {
  const initialAuth = getDaemonAuth();
  const daemonPort = await findActiveDaemonPort(initialAuth?.port);
  const targetUrl = `http://127.0.0.1:${daemonPort}`;

  const proxyConfig = {
    '^/(api|events|health|config|models|skills|sessions|project|projects|cd|chat|fs|terminal|git|provider-accounts|providers|shutdown|auth|telemetry)': {
      target: targetUrl,
      changeOrigin: true,
      ws: true,
      configure: (proxy: any) => {
        proxy.on('proxyReq', (proxyReq: any) => {
          const auth = getDaemonAuth();
          if (auth?.token) {
            if (!proxyReq.getHeader('authorization')) {
              proxyReq.setHeader('authorization', `Bearer ${auth.token}`);
            }
            const cookieName = `jeikcode_webui_${auth.port}`;
            const existingCookie = proxyReq.getHeader('cookie');
            if (!existingCookie || !String(existingCookie).includes(cookieName)) {
              proxyReq.setHeader(
                'cookie',
                existingCookie ? `${existingCookie}; ${cookieName}=${auth.token}` : `${cookieName}=${auth.token}`
              );
            }
          }
        });
        proxy.on('error', (err: any, req: any, res: any) => {
          console.warn(`[Vite Proxy Error] ${req?.url || ''} -> ${err?.message || err}`);
          if (res && typeof res.writeHead === 'function' && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `无法连接到本地后端守护进程 (${err?.message || err})`, code: 'daemon_unreachable' }));
          }
        });
      },
    },
  };

  return {
    plugins: [preact(), autoAuthPlugin(), mockApiPlugin(), localPluginsServePlugin()],
    base: './',
    resolve: {
      // Preact 必须是单例：`react` 被 alias 到 `preact/compat`，一旦预构建把 `preact`
      // 与 `preact/compat`/`preact/hooks` 拆成多份实例，`render()` 就无法识别已有根节点而不断追加
      // 新树，表现是同一页面里叠出多份侧栏/主区（点开会话却看到“发送消息开始对话…”）。
      dedupe: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime', 'preact/jsx-dev-runtime'],
      alias: {
        react: 'preact/compat',
        'react-dom': 'preact/compat',
        'react/jsx-runtime': 'preact/jsx-runtime',
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(getAppVersion()),
    },
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: proxyConfig,
    },
    preview: {
      host: '0.0.0.0',
      port: 5173,
      proxy: proxyConfig,
    },
  };
});
