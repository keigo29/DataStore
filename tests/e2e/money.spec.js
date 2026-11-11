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
  await expect(page.locator('.fRec:has-text("ランチ")')).toHaveCount(1);
  expect(errs).toEqual([]);
  await ctx.close();
});
