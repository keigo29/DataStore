// どのタブも開けて、エラーが出ないこと（PC とスマホ）
const { test, expect } = require('@playwright/test');
const { TABS, PC, PHONE, watchErrors, openApp, openTab } = require('./helpers');

for (const [name, opt] of [['PC', PC], ['スマホ', PHONE]]) {
  test.describe(name, () => {
    test.use(opt);
    test('すべてのタブを開ける', async ({ page }) => {
      const errs = watchErrors(page);
      await openApp(page);
      for (const t of TABS) {
        await openTab(page, t);
        await expect(page.locator('#view')).not.toBeEmpty();
      }
      expect(errs).toEqual([]);
    });
  });
}
