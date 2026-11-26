// PC のノート：見たままで書ける（# を打つとその場で見出し）。書いた中身は Markdown のまま保存される
const { test, expect } = require('@playwright/test');
const { PC, watchErrors, openApp, openTab } = require('./helpers');
test.use(PC);

test('見たままで書くと、見出しがその場で見出しになり、Markdown のまま保存される', async ({ page }) => {
  const errs = watchErrors(page);
  await openApp(page); await openTab(page, 'notes');
  await page.click('#sideNotes .nav:has-text("Inbox")');
  // はじめは見たまま。上の切り替えは 見たまま・書く・読む の3つ
  await expect(page.locator('#topActs .nt-mode button')).toHaveCount(3);
  await expect(page.locator('#topActs .nt-mode button.on')).toHaveText(/見たまま/);
  const doc = page.locator('.nt-liveDoc .cm-content');
  await expect(doc).toBeVisible();
  // 書式のツールバーも出る
  await expect(page.locator('.nt-liveBar .nt-tb, .nt-liveBar > *').first()).toBeVisible();
  await doc.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n# 見たままの見出し\nふつうの行');
  await page.waitForTimeout(400);
  // カーソルのない行の見出しは、記号が消えて見出しの見た目になる
  await expect(page.locator('.nt-liveDoc .cm-line:has-text("見たままの見出し")')).toHaveClass(/cm-lp-h1/);
  await page.waitForTimeout(900);
  // 書く画面に切りかえると、中身は Markdown のまま
  await page.click('#topActs .nt-mode button:has-text("書く")');
  await expect(page.locator('.nt-editor').first()).toBeVisible();
  const md = await page.locator('.nt-editor').first().inputValue();
  expect(md).toContain('# 見たままの見出し\nふつうの行');
  // 見たままに戻せる
  await page.click('#topActs .nt-mode button:has-text("見たまま")');
  await expect(page.locator('.nt-liveDoc .cm-content')).toBeVisible();
  expect(errs).toEqual([]);
});
