// スマホのノート：上に出る Markdown のボタン
const { test, expect } = require('@playwright/test');
const { PHONE, watchErrors, openApp, openTab } = require('./helpers');
test.use(PHONE);

test('チェック・見出し・マーカーのボタン', async ({ page }) => {
  const errs = watchErrors(page);
  await openApp(page); await openTab(page, 'notes');
  await page.click('#view .prow >> nth=0');
  await page.click('#view button:has-text("編集")');
  const ta = page.locator('.nt-editor').first();
  await ta.tap(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n牛乳を買う');
  await expect(page.locator('#mdBar')).toBeVisible();
  const K = label => page.locator(`#mdBar .mdK[aria-label^="${label}"]`).first().tap();
  const last = () => ta.evaluate(e => e.value.split('\n').slice(-1)[0]);
  await K('チェック'); expect(await last()).toBe('- [ ] 牛乳を買う');
  await K('チェック'); expect(await last()).toBe('牛乳を買う');
  await K('見出し'); await K('見出し'); expect(await last()).toBe('## 牛乳を買う');
  await K('見出し'); await K('見出し'); expect(await last()).toBe('牛乳を買う');
  await ta.evaluate(e => { const s = e.value.lastIndexOf('牛乳'); e.setSelectionRange(s, s + 2); });
  await K('マーカー'); expect(await last()).toContain('==牛乳==');
  await K('キーボードを閉じる');
  await expect(page.locator('#mdBar')).toBeHidden();
  expect(errs).toEqual([]);
});
