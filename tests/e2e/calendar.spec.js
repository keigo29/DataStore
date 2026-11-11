// カレンダー：タップで予定を入れる・名前を変える・ドラッグで動かす・消す
const { test, expect } = require('@playwright/test');
const { PC, PHONE, watchErrors, openApp, openTab } = require('./helpers');

test.describe('PC', () => {
  test.use(PC);
  test('ドラッグで予定を入れる', async ({ page }) => {
    const errs = watchErrors(page);
    await openApp(page); await openTab(page, 'cal');
    await page.click('.calSeg button:has-text("週")');
    const col = await page.locator('.cgCol').nth(2).boundingBox(), body = await page.locator('.cgBody').boundingBox();
    const x = col.x + 40, y = body.y + 120;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 100, { steps: 5 }); await page.mouse.up();
    await expect(page.locator('#evBar')).toBeVisible();
    await page.keyboard.type('レビュー'); await page.keyboard.press('Enter');
    await expect(page.locator('.cgEv:has-text("レビュー")')).toHaveCount(1);
    expect(errs).toEqual([]);
  });

  test('名前を変える・動かす・消す', async ({ page }) => {
    const errs = watchErrors(page);
    await openApp(page); await openTab(page, 'cal');
    await page.click('.calSeg button:has-text("週")');
    const ev = page.locator('.cgEv:has-text("朝会")').first();
    await ev.scrollIntoViewIfNeeded(); await ev.click();
    await page.fill('#sheetIn .inp >> nth=0', '朝会（オンライン）');
    await page.click('#sheetIn .shBtns .btn.primary');
    const ev2 = page.locator('.cgEv:has-text("朝会（オンライン）")');
    await expect(ev2).toHaveCount(1);
    await expect(page.locator('#sheet')).toBeHidden();
    await page.waitForTimeout(300);
    // 下に1時間ずらす
    const before = await ev2.locator('small').innerText();
    const bx = await ev2.boundingBox();
    await page.mouse.move(bx.x + 20, bx.y + 10); await page.mouse.down();
    await page.mouse.move(bx.x + 20, bx.y + 10 + 52, { steps: 8 }); await page.mouse.up();
    await expect(ev2.locator('small')).not.toHaveText(before);
    // 消す（2回押す）
    await page.locator('.cgEv:has-text("チームMTG")').first().click();
    await page.click('#sheetIn .btn.danger'); await page.click('#sheetIn .btn.danger');
    await expect(page.locator('.cgEv:has-text("チームMTG")')).toHaveCount(0);
    expect(errs).toEqual([]);
  });
});

test.describe('スマホ', () => {
  test.use(PHONE);
  test('時間をタップして予定を入れる', async ({ page }) => {
    const errs = watchErrors(page);
    await openApp(page); await openTab(page, 'cal');
    await page.click('.calSeg button:has-text("日")');
    await page.locator('.cgCol').first().tap({ position: { x: 150, y: Math.round(16.2 * 52) } });
    await expect(page.locator('.cgDraft')).toHaveCount(1);
    await expect(page.locator('#evBarTime')).toContainText('16:');
    await page.fill('#evBarIn', '歯医者'); await page.press('#evBarIn', 'Enter');
    await expect(page.locator('.cgEv:has-text("歯医者")')).toHaveCount(1);
    await expect(page.locator('#evBar')).toBeHidden();
    expect(errs).toEqual([]);
  });
});
