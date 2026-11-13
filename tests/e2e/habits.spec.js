// 毎日確認：項目は Notes/毎日確認.md、チェックはデイリーノートのプロパティ
const { test, expect } = require('@playwright/test');
const { PC, PHONE, watchErrors, mockGitHub, openApp, openTab, today } = require('./helpers');

const dayPath = k => `${k.replace(/-/g, '/')}/デイリー.md`;
const addDays = (k, n) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('見本のデータで表示できる（スマホ）', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE); const page = await ctx.newPage();
  const errs = watchErrors(page);
  await openApp(page); await openTab(page, 'habits');
  await expect(page.locator('.hb-kpi')).toHaveCount(4);
  await expect(page.locator('.hb-grid .cell')).toHaveCount(21);
  expect(errs).toEqual([]);
  await ctx.close();
});

test('項目を足す・チェックでデイリーノートのプロパティを書く・休みの日・TEDDY の 1 も読む', async ({ browser }) => {
  const ctx = await browser.newContext(PC); const page = await ctx.newPage();
  const t = today(), y = addDays(t, -1), y2 = addDays(t, -2);
  const gh = await mockGitHub(ctx, {
    'Inbox.md': '# Inbox\n',
    'Templates/デイリー.md': '## やること\n- \n## メモ\n- \n',
    [dayPath(y)]: '---\ntags: [日誌]\n運動: 1\n---\n## メモ\n',
    [dayPath(y2)]: '---\n運動: 1\n---\n',
  });
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  await openTab(page, 'habits');
  await expect(page.locator('.hb-empty')).toBeVisible();
  // 足す（ファイルができる）
  await page.click('.hb-empty button:has-text("確認項目を追加")');
  await page.fill('#sheetIn .inp >> nth=0', '運動');
  await page.click('#sheetIn .shBtns .btn.primary');
  await expect.poll(() => gh.remote.get('Notes/毎日確認.md')?.text || '').toMatch(/\| 運動 \| .+ \| #[0-9a-f]+ \| 毎日 \| 運動 \| 休む \| \d{4}-\d{2}-\d{2} \|/);
  await expect(page.locator('#side .hb-row:has-text("運動")')).toContainText('2日連続');   // TEDDY やノートで 1 にした分
  // 今日のチェック → 今日のデイリーノートに 運動: 1
  await page.locator('#side .hb-row:has-text("運動") .hb-chk').click();
  await expect.poll(() => gh.remote.get(dayPath(t))?.text || '').toMatch(/^---\n運動: 1\n---\n/);
  await expect(page.locator('#side .hb-row:has-text("運動")')).toContainText('3日連続');
  await expect(page.locator('#side .hb-ring b')).toHaveText('1/1');
  // 外す → 0
  await page.locator('#side .hb-row:has-text("運動") .hb-chk').click();
  await expect.poll(() => gh.remote.get(dayPath(t))?.text || '').toContain('運動: 0');
  // 今日を休みにする
  await page.click('#side .hb-offBtn');
  await expect.poll(() => gh.remote.get('Notes/毎日確認.md')?.text || '').toContain(`## 休みの日\n\n- ${t} 休み`);
  await expect(page.locator('#side .hb-todayText .msg')).toContainText('今日は休み');
  await expect(page.locator('#side .hb-row:has-text("運動")')).toContainText('2日連続');   // 休みの日は切れない
  expect(errs).toEqual([]);
  await ctx.close();
});
