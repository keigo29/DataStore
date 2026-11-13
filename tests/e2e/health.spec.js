// ヘルスのタブ：デイリーノートの体重・ヘルスケアの CSV・筋トレの CSV を読む／体重を書く
const { test, expect } = require('@playwright/test');
const { PC, PHONE, watchErrors, mockGitHub, openApp, openTab, today } = require('./helpers');

const dayPath = k => `${k.replace(/-/g, '/')}/デイリー.md`;
const addDays = (k, n) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('見本のデータで表示できる（スマホ）', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE); const page = await ctx.newPage();
  const errs = watchErrors(page);
  await openApp(page); await openTab(page, 'health');
  await expect(page.locator('.hKpis .fKpi')).toHaveCount(6);
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

test('睡眠の質：内訳から点数を出す・時間帯に切りかえる', async ({ browser }) => {
  const ctx = await browser.newContext(PC); const page = await ctx.newPage();
  const t = today(), D = n => addDays(t, -n);
  const head = 'date,weight_kg,body_fat_pct,sleep_min,steps,resting_hr,active_kcal,sleep_deep_min,sleep_core_min,sleep_rem_min,sleep_awake_min,bed_time,wake_time';
  const good = d => `${d},,,420,,,,70,250,100,10,23:00,06:10`;
  const csv = [head, good(D(4)), good(D(3)), good(D(2)), `${D(1)},,,300,,,,30,240,30,40,23:00,04:40`, good(D(0))].join('\n') + '\n';
  await mockGitHub(ctx, { 'Inbox.md': '# Inbox\n', 'Data/health/health.csv': csv });
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  await openTab(page, 'health');
  const card = page.locator('.sCard');
  await expect(card.locator('.sDetail .sBig')).toContainText('100');          // 今朝：7時間・深い17%・レム24%・10分・いつもどおり
  await expect(card.locator('.sStat:has-text("寝た時刻") b')).toHaveText('23:00');
  await expect(card.locator('.sPlot.line path.sL')).toHaveCount(4);              // はじめは1日ごとの線（深い・ノンレム・レム・途中で起きた）
  await expect(card.locator('.sLegend')).toContainText('ノンレム');
  await card.locator('.hSeg button:has-text("積み上げ")').click();
  await card.locator('.sCol').nth(-2).click();                                // きのうの朝：5時間・深い10%・レム10%・40分
  await expect(card.locator('.sDetail .sBig')).toContainText('24');
  await expect(card.locator('.sWhy')).toContainText('7時間まで あと 2:00');
  await card.locator('.hSeg button:has-text("時間帯")').click();
  await expect(page.locator('.sCard .sRange')).toHaveCount(5);
  expect(errs).toEqual([]);
  await ctx.close();
});

test('睡眠の1晩の流れ：sleep.csv から段ごとのブロックを出す・前の晩へ', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE); const page = await ctx.newPage();
  const t = today(), y = addDays(t, -1), yy = addDays(t, -2);
  const night = (d, p) => [`${d},${p}T23:30,${d}T00:30,core`, `${d},${d}T00:30,${d}T01:30,deep`, `${d},${d}T01:30,${d}T02:00,rem`, `${d},${d}T02:00,${d}T02:10,awake`, `${d},${d}T02:10,${d}T06:30,core`];
  const head = 'date,weight_kg,body_fat_pct,sleep_min,steps,resting_hr,active_kcal,sleep_deep_min,sleep_core_min,sleep_rem_min,sleep_awake_min,bed_time,wake_time';
  await mockGitHub(ctx, {
    'Inbox.md': '# Inbox\n',
    'Data/health/health.csv': [head, `${y},,,410,,,,60,320,30,10,23:30,06:30`, `${t},,,410,,,,60,320,30,10,23:30,06:30`].join('\n') + '\n',
    'Data/health/sleep.csv': ['date,start,end,stage', ...night(y, yy), ...night(t, y)].join('\n') + '\n',
  });
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  await openTab(page, 'health');
  const card = page.locator('.sCard');
  await expect(card.locator('.sSeg')).toHaveCount(5);                       // はじめから「1晩」
  await expect(card.locator('.sNavT b')).toHaveText('6時間50分');
  await expect(card.locator('.sHAx span').first()).toHaveText('23:00');
  await expect(card.locator('.sNavB').nth(1)).toBeDisabled();
  await card.locator('.sNavB').first().click();                             // 前の晩
  await expect(card.locator('.sNavB').first()).toBeDisabled();
  await expect(card.locator('.sSeg')).toHaveCount(5);
  await card.locator('.hSeg button:has-text("線")').click();
  await expect(card.locator('.sPlot.line')).toBeVisible();
  expect(errs).toEqual([]);
  await ctx.close();
});

test('気分：ホームの顔で書く・ひとことつきで書く・TEDDY が書いた行も読む', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE); const page = await ctx.newPage();
  const t = today(), y = addDays(t, -1);
  const gh = await mockGitHub(ctx, {
    'Inbox.md': '# Inbox\n',
    'Templates/デイリー.md': '## やること\n- \n## メモ\n- \n',
    [`${y.replace(/-/g, '/')}/TEDDY メモ.md`]: '---\ntags: [日誌]\n---\n- 気分 2/5 寝不足\n- 気分：4\n',
  });
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  await page.locator('.mdW .mdF').nth(3).click();                          // 🙂 良い
  await expect.poll(() => gh.remote.get(dayPath(t))?.text || '').toContain('## メモ\n- 気分 4/5\n');
  await expect(page.locator('.mdW .mdF.on')).toHaveCount(1);
  await openTab(page, 'health');
  await page.click('.fBar button:has-text("気分を書く")');
  await page.locator('#sheetIn .mdF').nth(4).click();
  await page.fill('#sheetIn .inp', '散歩した');
  await page.click('#sheetIn .shBtns .btn.primary');
  await expect.poll(() => gh.remote.get(dayPath(t))?.text || '').toContain('- 気分 4/5\n- 気分 5/5 散歩した');
  await expect(page.locator('.fKpi:has-text("気分") .fVal')).toContainText('3.8');   // きのう 3.0・今日 4.5
  await expect(page.locator('.mdRec').first()).toContainText('散歩した');
  await expect(page.locator('.mdRec:has-text("寝不足")')).toHaveCount(1);
  expect(errs).toEqual([]);
  await ctx.close();
});
