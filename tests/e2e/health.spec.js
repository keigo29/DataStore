// ヘルスのタブ：デイリーノートの体重・ヘルスケアの CSV・筋トレの CSV を読む／体重を書く
const { test, expect } = require('@playwright/test');
const { PC, PHONE, watchErrors, mockGitHub, openApp, openTab, today } = require('./helpers');

const dayPath = k => `${k.replace(/-/g, '/')}/デイリー.md`;
const addDays = (k, n) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('見本のデータで表示できる（スマホ）', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE); const page = await ctx.newPage();
  const errs = watchErrors(page);
  await openApp(page); await openTab(page, 'health');
  await expect(page.locator('.hKpis .fKpi')).toHaveCount(5);
  expect(await page.locator('.hDots i').count()).toBeGreaterThan(5);
  expect(await page.locator('.fRec').count()).toBeGreaterThan(0);
  expect(errs).toEqual([]);
  await ctx.close();
});

test('ノートと CSV から数字を出し、体重をデイリーノートに書く', async ({ browser }) => {
  const ctx = await browser.newContext(PC); const page = await ctx.newPage();
  const t = today(), y = addDays(t, -1);
  const files = {
    [dayPath(y)]: '---\ntags: [日誌]\n---\n## やること\n\n## メモ\n- 体重 71.0kg [[減量]]\n',
    'Projects/減量.md': '---\ncolor: "#ff7a1a"\n---\n- 仮の目標：**67kg（2027-02-28）**\n',
    'Templates/デイリー.md': '## やること\n- \n## メモ\n- \n',
    'Data/health/health.csv': `date,weight_kg,body_fat_pct,sleep_min,steps,resting_hr,active_kcal\n${y},,,420,9000,58,300\n`,
    'Data/kintore/sets.csv': `date,start,session_id,effort,exercise,muscle_group,bodyweight,set_no,kind,weight_kg,reps,rir,assisted,e1rm_kg,volume_kg,note\n${y},19:00,a,,ベンチプレス,胸,0,1,normal,75,5,,0,87.5,375,"メモ, カンマあり"\n${y},19:00,a,,ベンチプレス,胸,0,2,normal,70,5,,0,81.7,350,\n`,
  };
  const gh = await mockGitHub(ctx, files);
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  await openTab(page, 'health');
  await expect(page.locator('.fKpi:has-text("体重") .fVal')).toContainText('71.0');
  await expect(page.locator('.fKpi:has-text("目標まで") .fVal')).toContainText('4.0');
  await expect(page.locator('.fKpi:has-text("歩数") .fVal')).toContainText('9,000');
  await expect(page.locator('.fCat:has-text("ベンチプレス")')).toContainText('1RM 87.5kg');
  await expect(page.locator('.fRec').first()).toContainText('725kg');
  // 体重を書く → 今日のデイリーノート（テンプレートから作る）の「メモ」に入る
  await page.click('.fBar button:has-text("体重を書く")');
  await page.fill('#sheetIn .inp >> nth=0', '70.4');
  await page.click('#sheetIn .shBtns .btn.primary');
  await expect.poll(() => gh.remote.get(dayPath(t))?.text || '').toContain('## メモ\n- 体重 70.4kg [[減量]]');
  expect(gh.remote.get(dayPath(t)).text).not.toMatch(/## メモ\n- 体重 70.4kg \[\[減量\]\]\n- \n/);
  await expect(page.locator('.fKpi:has-text("体重") .fVal')).toContainText('70.7');   // 2日の平均
  // 同じ日にもう一度書くと、行を書きかえる
  await page.click('.fBar button:has-text("体重を書く")');
  await page.fill('#sheetIn .inp >> nth=0', '70.2');
  await page.click('#sheetIn .shBtns .btn.primary');
  await expect.poll(() => gh.remote.get(dayPath(t))?.text || '').toContain('- 体重 70.2kg');
  expect((gh.remote.get(dayPath(t)).text.match(/体重/g) || []).length).toBe(1);
  expect(errs).toEqual([]);
  await ctx.close();
});
