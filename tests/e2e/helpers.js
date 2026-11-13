// 画面のテストの道具
const { expect } = require('@playwright/test');

const PC = { viewport: { width: 1400, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

// 画面のエラーを集める（テストの終わりに「なし」を確かめる）
function watchErrors(page) {
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  return errs;
}

// GitHub のふり。本物と同じく、古い版の印（sha）で書こうとすると 409 で断る
// files: { 'パス': '中身' }。delay：書くのにかかる時間（ミリ秒）
async function mockGitHub(context, files, { delay = 0 } = {}) {
  const remote = new Map(Object.entries(files).map(([p, t], i) => [p, { sha: 's' + (i + 1), text: t }]));
  let n = remote.size;
  const log = [];
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const b64 = t => Buffer.from(t, 'utf8').toString('base64');
  await context.route('https://api.github.com/**', async route => {
    const req = route.request(), url = req.url(), m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
    if (url.includes('/git/trees/')) return route.fulfill({ headers: H, json: { tree: [...remote].map(([path, f]) => ({ path, type: 'blob', sha: f.sha })) } });
    if (url.includes('/git/blobs/')) {
      const sha = url.split('/git/blobs/')[1];
      const f = [...remote.values()].find(x => x.sha === sha);
      return f ? route.fulfill({ headers: H, json: { content: b64(f.text) } }) : route.fulfill({ status: 404, headers: H, json: {} });
    }
    const path = url.includes('/contents/') ? decodeURIComponent(url.split('/contents/')[1].split('?')[0]) : null;
    if (path && m === 'PUT') {
      const body = JSON.parse(req.postData());
      if (delay) await new Promise(r => setTimeout(r, delay));
      const cur = remote.get(path);
      if ((cur && body.sha !== cur.sha) || (!cur && body.sha)) { log.push({ path, status: 409 }); return route.fulfill({ status: 409, headers: H, json: { message: 'sha does not match' } }); }
      const sha = 's' + ++n;
      remote.set(path, { sha, text: Buffer.from(body.content, 'base64').toString('utf8') });
      log.push({ path, status: 200, sha });
      return route.fulfill({ headers: H, json: { content: { sha } } });
    }
    if (path && m === 'DELETE') { remote.delete(path); log.push({ path, status: 200, del: true }); return route.fulfill({ headers: H, json: {} }); }
    return route.fulfill({ status: 404, headers: H, json: {} });
  });
  return { remote, log };
}

// アプリを開く。connect：GitHub につないだ形で（mockGitHub と組で）
async function openApp(page, { connect = false } = {}) {
  await page.goto('./');
  if (connect) {
    await page.evaluate(() => localStorage.setItem('ws-notes.config', JSON.stringify({ owner: 'me', repo: 'notes', token: 'test' })));
    await page.reload();
  }
  await expect(page.locator('#title')).toBeVisible();
  await page.waitForTimeout(400);
}
// タブを開く（PC は左の列、スマホは下のメニュー）
const TABS = ['home', 'todo', 'proj', 'cal', 'habits', 'notes', 'graph', 'money', 'health'];
async function openTab(page, tab) {
  const wide = await page.evaluate(() => document.documentElement.classList.contains('wide'));
  if (wide) await page.click(`#railApps .railBtn[data-tab="${tab}"]`);
  else await page.click(`#tabs [data-tab="${tab}"]`, { force: true });
  await page.waitForTimeout(300);
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

module.exports = { TABS, PC, PHONE, watchErrors, mockGitHub, openApp, openTab, today };
