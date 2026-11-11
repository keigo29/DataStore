// ノートの自動保存：送っている最中に消して打ち直しても、409（書きかえの食いちがい）にならない
const { test, expect } = require('@playwright/test');
const { PC, watchErrors, mockGitHub, openApp, openTab } = require('./helpers');
test.use(PC);

test('送信中に打ち直しても同期エラーにならない', async ({ page, context }) => {
  test.setTimeout(90_000);
  const gh = await mockGitHub(context, { 'Inbox.md': '# Inbox\n\n- [ ] 牛乳\n' }, { delay: 1500 });
  const errs = watchErrors(page);
  await openApp(page, { connect: true });
  await page.waitForTimeout(800);
  await openTab(page, 'notes');
  await page.click('#sideNotes .nav:has-text("Inbox")');
  await page.click('#topActs .nt-mode button:has-text("書く")');
  const ed = page.locator('.nt-editor');
  await ed.click(); await page.keyboard.press('Control+End');
  await page.keyboard.type('\n- [ ] たまごを買う');
  await page.waitForTimeout(4300);                       // 送りはじめる
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');   // 送っている最中に消す
  await page.keyboard.type('かう');
  await page.waitForTimeout(7000);
  await page.keyboard.type('！');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await page.keyboard.type('る');
  await expect.poll(async () => gh.remote.get('Inbox.md').text === await ed.inputValue(), { timeout: 20_000 }).toBe(true);
  expect(gh.log.filter(l => l.status === 409)).toEqual([]);
  expect(gh.log.filter(l => l.status === 200).length).toBeGreaterThanOrEqual(2);
  expect(await ed.inputValue()).toContain('- [ ] たまかる');
  expect(errs).toEqual([]);
});
