// お金のタブ：Data/kakei.json を読んで、残高・カテゴリ・目標を出す
const { test, expect } = require('@playwright/test');
const { PC, PHONE, watchErrors, mockGitHub, openApp, openTab, today } = require('./helpers');

for (const [name, opt] of [['PC', PC], ['スマホ', PHONE]]) {
  test(`見本のデータで表示できる（${name}）`, async ({ browser }) => {
    const ctx = await browser.newContext(opt); const page = await ctx.newPage();
    const errs = watchErrors(page);
    await openApp(page); await openTab(page, 'money');
    await expect(page.locator('.fKpi').first()).toBeVisible();
    expect(await page.locator('.fAcct').count()).toBeGreaterThan(0);
    expect(errs).toEqual([]);
    await ctx.close();
  });
}

test('kakei.json から口座の残高を正しく計算する', async ({ browser }) => {
  const ctx = await browser.newContext(PC); const page = await ctx.newPage();
  const d = today();
  const kakei = {
    accounts: [{ id: 'b', name: 'テスト銀行', type: 'bank', initial: 100000, order: 1 }, { id: 'w', name: 'テスト財布', type: 'cash', initial: 0, order: 2 }],
    txs: [
      { date: d, type: 'income', amount: 5000, accountId: 'b', category: 'salary', memo: 'おこづかい' },
      { date: d, type: 'expense', amount: 1200, accountId: 'b', category: 'food', memo: 'ランチ' },
      { date: d, type: 'transfer', amount: 300, accountId: 'b', toAccountId: 'w' },
    ],
  };
  await mockGitHub(ctx, { 'Inbox.md': '# Inbox\n', 'Data/kakei.json': JSON.stringify(kakei) });
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  await openTab(page, 'money');
  await expect(page.locator('.fAcct:has-text("テスト銀行")')).toContainText('103,500');
  await expect(page.locator('.fAcct:has-text("テスト財布")')).toContainText('300');
  await expect(page.locator('.fList .fRec:has-text("ランチ")')).toHaveCount(1);
  expect(errs).toEqual([]);
  await ctx.close();
});

test('お金のカレンダー：使った額と出費の予定。予定を足す・払ったにする', async ({ browser }) => {
  const ctx = await browser.newContext(PC); const page = await ctx.newPage();
  const d = today();
  const later = d;   // 今日（月末でもその月に入るように）
  const kakei = { accounts: [{ id: 'b', name: '銀行', type: 'bank', initial: 0, order: 1 }], txs: [{ date: d, type: 'expense', amount: 1200, accountId: 'b', category: 'food', memo: 'ランチ' }] };
  const gh = await mockGitHub(ctx, { 'Inbox.md': `# Inbox\n\n- [ ] 💸 4,980 スマホ代 #通信 📅 ${later}\n`, 'Data/kakei.json': JSON.stringify(kakei) });
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  await openTab(page, 'money');
  await expect(page.locator('.mD.today .o')).toHaveText('−1,200');
  await expect(page.locator('.mD .p').first()).toContainText('4,980');
  await expect(page.locator('.mCal > .fSub')).toContainText('¥4,980');
  // 予定を足す
  await page.click('.mCal button:has-text("出費の予定")');
  await page.fill('#sheetIn .inp >> nth=0', '家賃');
  await page.fill('#sheetIn .inp >> nth=1', '68000');
  await page.fill('#sheetIn .inp >> nth=2', later);
  await page.click('#sheetIn .shBtns .btn.primary');
  await expect.poll(() => gh.remote.get('Inbox.md').text).toContain(`- [ ] 💸 68,000 家賃 📅 ${later}`);
  await expect(page.locator('.mD .p').first()).toContainText('7.3万');
  // その日を開いて「払った」
  await expect(page.locator('.mDay .mPlan')).toHaveCount(2);
  await page.locator('.mDay .mPlan:has-text("家賃") .tchk').click();
  await expect.poll(() => gh.remote.get('Inbox.md').text).toContain(`- [x] 💸 68,000 家賃 📅 ${later}`);
  await expect(page.locator('.mD .p').first()).toContainText('4,980');
  expect(errs).toEqual([]);
  await ctx.close();
});

test('出費の予定をホームから直す・消す', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE); const page = await ctx.newPage();
  const d = today();
  const gh = await mockGitHub(ctx, { 'Inbox.md': `# Inbox\n\n- [ ] 💸 4,980 スマホ代 #通信 [[固定費]] 📅 ${d}\n- [ ] 💸 5,000 飲み会 📅 ${d}\n` });
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  const w = page.locator('.mWidget');
  await expect(w.locator('.mPlan')).toHaveCount(2);
  await expect(w.locator('.mWSub')).toContainText('¥9,980');
  // 直す：金額と名前。カテゴリ以外のリンクは残る
  await w.locator('.mPlan:has-text("スマホ代") .fRn').click();
  await page.fill('#sheetIn .inp >> nth=0', 'スマホ代（11月）');
  await page.fill('#sheetIn .inp >> nth=1', '5200');
  await page.click('#sheetIn .shBtns .btn.primary');
  await expect.poll(() => gh.remote.get('Inbox.md').text).toContain(`- [ ] 💸 5,200 スマホ代（11月） #通信 [[固定費]] 📅 ${d}`);
  await expect(w.locator('.mWSub')).toContainText('¥10,200');
  // 消す（2回押す）
  await w.locator('.mPlan:has-text("飲み会") .fRn').click();
  await page.click('#sheetIn .btn.danger'); await page.click('#sheetIn .btn.danger');
  await expect.poll(() => gh.remote.get('Inbox.md').text).not.toContain('飲み会');
  await expect(w.locator('.mPlan')).toHaveCount(1);
  // 払った
  await w.locator('.mPlan .tchk').click();
  await expect.poll(() => gh.remote.get('Inbox.md').text).toContain('- [x] 💸 5,200');
  expect(errs).toEqual([]);
  await ctx.close();
});

test('資産から出費の予定を引いた残りを出す', async ({ browser }) => {
  const ctx = await browser.newContext(PC); const page = await ctx.newPage();
  const d = today();
  const kakei = { accounts: [{ id: 'b', name: '銀行', type: 'bank', initial: 100000, order: 1 }], txs: [] };
  await mockGitHub(ctx, { 'Inbox.md': `# Inbox\n\n- [ ] 💸 30,000 家賃 📅 ${d}\n- [x] 💸 5,000 払った分 📅 ${d}\n- [ ] 💸 1,000 来年 📅 2099-01-01\n`, 'Data/kakei.json': JSON.stringify(kakei) });
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  await expect(page.locator('.mWAfter')).toContainText('¥70,000');           // ホーム：30日分だけ引く
  await openTab(page, 'money');
  const a = page.locator('.fAfter');
  await expect(a.locator('.fAR.minus b')).toHaveText('−¥31,000');           // まだ払っていない分（払った分は引かない）
  await expect(a.locator('.fAR.rest b')).toHaveText('¥69,000');
  await expect(a.locator('.fANote')).toContainText('¥70,000');               // 今月末までなら
  expect(errs).toEqual([]);
  await ctx.close();
});
