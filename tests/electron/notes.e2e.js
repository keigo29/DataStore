// Mac 版（Electron）のノート：画像・書く・名前の変更（リンクも直る）・新しいノート・git の同期
// 使い方：cd mac && npm ci && cd .. && npm run test:electron（Linux は xvfb-run を前につける）
const { _electron } = require('@playwright/test');
const assert = require('assert');
const MAC = require('path').join(__dirname, '..', '..', 'mac');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdwsnt-'));
  const remote = path.join(tmp, 'remote.git'); sh(tmp, 'init', '--bare', '-b', 'main', remote);
  const vault = path.join(tmp, 'ナレッジ'); sh(tmp, 'clone', remote, vault);
  sh(vault, 'config', 'user.email', 't@e.com'); sh(vault, 'config', 'user.name', 't'); sh(vault, 'checkout', '-B', 'main');
  fs.mkdirSync(path.join(vault, 'Notes'));
  fs.mkdirSync(path.join(vault, 'img'));
  fs.writeFileSync(path.join(vault, 'img', 'a.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(path.join(vault, 'Notes', 'Spring Boot メモ.md'), `---\ntags: [java]\n---\n# Spring\n![[a.png]]\n`);
  fs.writeFileSync(path.join(vault, 'Inbox.md'), `- [ ] あとで [[Spring Boot メモ]] を読む\n`);
  sh(vault, 'add', '-A'); sh(vault, 'commit', '-m', 'first'); sh(vault, 'push', '-u', 'origin', 'main');
  const cfgHome = path.join(tmp, 'cfg'); fs.mkdirSync(path.join(cfgHome, 'MD Workstation'), { recursive: true });
  fs.writeFileSync(path.join(cfgHome, 'MD Workstation', 'config.json'), JSON.stringify({ folder: vault, autoGit: true }));
  const app = await _electron.launch({ args: [MAC, '--no-sandbox'], executablePath: require(path.join(MAC, 'node_modules', 'electron')),
    env: { ...process.env, XDG_CONFIG_HOME: cfgHome, GIT_CONFIG_GLOBAL: '/dev/null' } });
  const w = await app.firstWindow();
  const errs = []; w.on('pageerror', e => errs.push(String(e))); w.on('console', m => m.type() === 'error' && errs.push(m.text()));
  w.on('dialog', d => d.accept());
  await w.setViewportSize({ width: 1300, height: 860 });
  await sleep(1500);
  await w.click('#railApps .railBtn:nth-child(5)'); await sleep(800);
  await w.click('#sideNotes .nav:has-text("Notes")'); await sleep(300);
  await w.click('#sideNotes .nav:has-text("Spring Boot")'); await sleep(800);
  await w.click('#topActs .nt-mode button:has-text("読む")'); await sleep(1200);
  const img = await w.evaluate("[...document.querySelectorAll('.nt-doc img')].map(i=>[i.dataset.vault,i.src.slice(0,10),i.naturalWidth])");
  assert.ok(img.length === 1 && img[0][2] === 1, '画像が出ない ' + JSON.stringify(img));
  await w.click('#topActs .nt-mode button:has-text("書く")');
  await w.click('.nt-editor'); await w.keyboard.press('Control+End'); await w.keyboard.type('\n追記した');
  await sleep(2500);
  assert.ok(fs.readFileSync(path.join(vault, 'Notes', 'Spring Boot メモ.md'), 'utf8').includes('追記した'), '書いた分がファイルに入らない');
  // 名前を変える → Inbox のリンクも書きかわる
  await w.click('#topActs .nt-more button[title*="名前"]'); await sleep(300);
  await w.fill('dialog.askDlg input.inp', 'Spring メモ'); await w.click('dialog.askDlg button:has-text("変更")'); await sleep(1500);
  assert.ok(fs.existsSync(path.join(vault, 'Notes', 'Spring メモ.md')) && !fs.existsSync(path.join(vault, 'Notes', 'Spring Boot メモ.md')), '名前が変わらない');
  assert.ok(fs.readFileSync(path.join(vault, 'Inbox.md'), 'utf8').includes('[[Spring メモ]]'), 'リンクが書きかわらない');
  // 新しいノート
  await w.click('#sideNotes .nt-sideTop .btn.primary'); await sleep(800);
  await w.fill('dialog.askDlg input.inp', '新しいメモ'); await w.click('dialog.askDlg button:has-text("変更")'); await sleep(1000);
  await w.keyboard.type('hello'); await sleep(2500);
  assert.ok(fs.readdirSync(path.join(vault, 'Notes')).includes('新しいメモ.md'), '新しいノートができない');
  await sleep(8000);
  assert.ok(sh(remote, 'log', '--format=%s', 'main').split('\n').length > 1, 'git に送られない');
  // やることタブに切りかえても大丈夫
  await w.click('#railApps .railBtn:nth-child(2)'); await sleep(500);
  await w.locator('#sideBody .nav[aria-label="すべて"]').first().click(); await sleep(400);
  assert.ok(await w.locator('#view :text("あとで")').count() > 0, 'やることに出ない');
  assert.deepStrictEqual(errs, []);
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('✓ Mac 版のノートのテスト OK');
})().catch(e => { console.error(e); process.exit(1); });
