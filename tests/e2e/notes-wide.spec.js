// PC のノート：書いたやることが「やること」タブに出る
const { test, expect } = require('@playwright/test');
const { PC, watchErrors, openApp, openTab } = require('./helpers');
test.use(PC);

test('ノートに書いたやることがやることタブに出る', async ({ page }) => {
  const errs = watchErrors(page);
  page.on('dialog', d => d.accept());
  await openApp(page); await openTab(page, 'notes');
  await page.click('#sideNotes .nav:has-text("Inbox")');
  await page.click('#topActs .nt-mode button:has-text("書く")');
  await page.locator('.nt-editor').click(); await page.keyboard.press('Control+End');
  await page.keyboard.type('\n- [ ] テストのやること 📅 2026-11-12');
  await page.waitForTimeout(600);
  await openTab(page, 'todo');
  await page.locator('#sideBody .nav[aria-label="すべて"]').first().click();
  await expect(page.locator('#view :text("テストのやること")').first()).toBeVisible();
  await openTab(page, 'notes');
  expect(await page.locator('.nt-editor').first().inputValue()).toContain('テストのやること');
  expect(errs).toEqual([]);
});
