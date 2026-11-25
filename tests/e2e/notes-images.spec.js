// PC のノート：貼りつけた画像がフォルダの中に並び、押すと大きく見られる（旧 Workstation と同じ）
const { test, expect } = require('@playwright/test');
const { PC, watchErrors, openApp, openTab } = require('./helpers');
test.use(PC);

test('画像を貼りつけると、ノートの一覧に出て、押すと大きく見られる', async ({ page }) => {
  const errs = watchErrors(page);
  await openApp(page); await openTab(page, 'notes');
  await page.click('#sideNotes .nav:has-text("Inbox")');
  await page.click('#topActs .nt-mode button:has-text("書く")');
  await page.locator('.nt-editor').click();
  // 1×1 の PNG を貼りつける
  await page.evaluate(() => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'テスト画像.png', { type: 'image/png' }));
    document.querySelector('.nt-editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => page.locator('.nt-editor').first().inputValue()).toContain('![[テスト画像.png]]');
  const row = page.locator('#sideNotes .nt-att:has-text("テスト画像.png")');
  await expect(row).toBeVisible();
  await row.click();
  const img = page.locator('dialog.nt-attDlg img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate(i => i.naturalWidth)).toBe(1);
  await page.click('dialog.nt-attDlg button:has-text("閉じる")');
  await expect(page.locator('dialog.nt-attDlg')).toHaveCount(0);
  expect(errs).toEqual([]);
});
