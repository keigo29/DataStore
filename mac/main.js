// MD Workstation（Mac 版）
// 画面は PWA と同じ（app/）。データは選んだフォルダの .md を直接読み書きし、git で GitHub と自動同期する
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { Vault, Git } = require('./backend');

const CONF = () => path.join(app.getPath('userData'), 'config.json');
let conf = { folder: '', autoGit: true };
let win = null, vault = null, git = null, watcher = null;
let last = {};                 // 前に読んだもの（読み直しを少なくする）
let pending = [];              // まだ commit していない変更のメッセージ
let commitTimer = null, changedTimer = null, pullTimer = null;
let ownWrite = 0;              // 自分で書いた直後のフォルダの変化は、外からの変更として数えない

function loadConf() { try { conf = { ...conf, ...JSON.parse(fs.readFileSync(CONF(), 'utf8')) }; } catch {} }
function saveConf() { try { fs.mkdirSync(path.dirname(CONF()), { recursive: true }); fs.writeFileSync(CONF(), JSON.stringify(conf, null, 2)); } catch {} }
const send = (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };

async function status() {
  const g = git ? await git.status() : { repo: false };
  return { folder: conf.folder, autoGit: conf.autoGit, git: g, pending: pending.length };
}
async function pushStatus() { send('mdws:status', await status()); }

function openFolder(folder) {
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  last = {}; pending = [];
  if (!folder || !fs.existsSync(folder)) { vault = null; git = null; return; }
  vault = new Vault(folder);
  git = new Git(folder);
  // 外（ほかのエディタ・git pull）での変更：画面を読み直し、自動同期なら少し待って commit
  try {
    watcher = fs.watch(folder, { recursive: true }, (ev, name) => {
      const n = String(name || '').split(path.sep).join('/');
      if (!n || n.startsWith('.git/') || n.includes('/.git/') || n.endsWith('.mdws-tmp')) return;
      clearTimeout(changedTimer);
      changedTimer = setTimeout(() => send('mdws:changed'), 400);
      if (/\.md$/i.test(n) && Date.now() - ownWrite > 1500) scheduleCommit('外で書きかえたノートを保存', 20000);
    });
  } catch {}
}

// 変更をまとめて commit・push（書いてから少し待って、続けて書いた分を1つにする）
function scheduleCommit(msg, wait = 4000) {
  if (msg) pending.push(msg);
  if (!conf.autoGit || !git) { pushStatus(); return; }
  clearTimeout(commitTimer);
  commitTimer = setTimeout(flush, wait);
}
async function flush() {
  clearTimeout(commitTimer);
  if (!git) return;
  const msgs = [...new Set(pending)];
  const message = msgs.length === 1 ? msgs[0] : msgs.length ? `ノートを更新（${msgs.length}件）\n\n${msgs.map(m => '- ' + m).join('\n')}` : 'ノートを更新';
  const r = await git.commitPush(message);
  if (r.ok || r.skipped) pending = [];
  if (!r.ok && !r.skipped) send('mdws:toast', r.error);
  pushStatus();
}
async function pullNow() {
  if (!git) return { ok: false };
  const r = await git.pull();
  if (!r.ok && !r.skipped) send('mdws:toast', r.error);
  pushStatus();
  return r;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 420, minHeight: 560,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0c' : '#f3f4f5',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // リンクはいつものブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  // 戻ってきたとき、1分以上たっていれば取り込む
  let lastFocusPull = Date.now();
  win.on('focus', async () => { if (conf.autoGit && git && Date.now() - lastFocusPull > 60000) { lastFocusPull = Date.now(); const r = await pullNow(); if (r.ok && r.changed) send('mdws:changed'); } });
}

// ---------- 画面とのやりとり ----------
ipcMain.handle('mdws:status', () => status());
ipcMain.handle('mdws:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'ノートのフォルダを選ぶ', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return status();
  conf.folder = r.filePaths[0]; saveConf();
  openFolder(conf.folder);
  return status();
});
ipcMain.handle('mdws:forget', () => { conf.folder = ''; saveConf(); openFolder(''); return status(); });
ipcMain.handle('mdws:setAuto', (e, on) => { conf.autoGit = !!on; saveConf(); if (on && pending.length) scheduleCommit(null, 500); return status(); });
ipcMain.handle('mdws:scan', async () => {
  if (!vault) return { error: 'nofolder' };
  const r = await vault.scan(last);
  last = r.files;
  return r;
});
ipcMain.handle('mdws:write', async (e, rel, text, sha, message) => {
  if (!vault) return { error: 'フォルダを選んでください', status: 400 };
  try {
    ownWrite = Date.now();
    const s = await vault.write(rel, text, sha);
    last[rel] = { sha: s, text };
    scheduleCommit(message);
    return { sha: s };
  } catch (err) { return { error: err.message, status: err.status || 500 }; }
});
// 「同期」：取り込む → まだの変更を送る
ipcMain.handle('mdws:sync', async () => {
  if (!git) return { ok: false, ...(await status()) };
  const p = await pullNow();
  if (conf.autoGit || pending.length) await flush();
  return { ok: p.ok || p.skipped, error: p.error, ...(await status()) };
});
ipcMain.handle('mdws:openFolder', () => { if (conf.folder) shell.openPath(conf.folder); });
// ノートの画面（旧 Workstation のノート）用：消す・移す・フォルダ・画像・Finder・Obsidian
const fileOp = (name, fn) => ipcMain.handle('mdws:' + name, async (e, ...a) => {
  if (!vault) return { error: 'フォルダを選んでください', status: 400 };
  try { ownWrite = Date.now(); const r = await fn(...a); return { ok: true, value: r }; } catch (err) { return { error: err.message, status: err.status || 500 }; }
});
fileOp('remove', async (rel, msg) => { await vault.remove(rel); delete last[rel]; scheduleCommit(msg || `削除: ${rel}`); });
fileOp('move', async (from, to, msg) => { await vault.move(from, to); if (last[from]) { last[to] = last[from]; delete last[from]; } scheduleCommit(msg || `移動: ${from} → ${to}`); });
fileOp('mkdir', rel => vault.mkdir(rel));
fileOp('rmdir', async (rel, msg) => { await vault.rmdir(rel); scheduleCommit(msg || `フォルダを削除: ${rel}`); });
fileOp('writeBin', async (rel, b64, msg) => { const s = await vault.writeBin(rel, b64); scheduleCommit(msg || `画像: ${rel}`); return s; });
fileOp('readBin', rel => vault.readBin(rel));
ipcMain.handle('mdws:reveal', (e, rel) => { if (!conf.folder) return; try { if (rel) shell.showItemInFolder(vault.absAny(rel)); else shell.openPath(conf.folder); } catch {} });
ipcMain.handle('mdws:openInObsidian', (e, rel) => { if (!conf.folder) return; try { shell.openExternal('obsidian://open?path=' + encodeURIComponent(vault.abs(rel))); } catch {} });
ipcMain.handle('mdws:openExternal', (e, url) => { if (/^https?:/i.test(url)) shell.openExternal(url); });

// ---------- はじめ・おわり ----------
app.whenReady().then(async () => {
  // npm start のときも Dock に自前のアイコンを出す（.app にしたときは electron-builder が入れる）
  if (!app.isPackaged && app.dock) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));
  loadConf();
  openFolder(conf.folder);
  createWindow();
  if (conf.autoGit && git) pullNow().then(r => { if (r.ok && r.changed) send('mdws:changed'); });
  // 5分ごとに取り込む
  pullTimer = setInterval(async () => { if (conf.autoGit && git) { const r = await pullNow(); if (r.ok && r.changed) send('mdws:changed'); } }, 5 * 60 * 1000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// 閉じる前に、まだの変更を送る
let quitting = false;
app.on('before-quit', async e => {
  if (quitting || !git || !pending.length || !conf.autoGit) return;
  e.preventDefault(); quitting = true;
  try { await Promise.race([flush(), new Promise(r => setTimeout(r, 8000))]); } finally { app.quit(); }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
