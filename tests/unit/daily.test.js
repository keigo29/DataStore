// デイリーノートの場所（app/daily.js：Obsidian の daily-notes.json に合わせる）
const test = require('node:test');
const assert = require('node:assert/strict');
const Daily = require('../../app/daily.js');

test('日付のフォルダ：YYYY/MM/DD/[デイリー]', () => {
  const cfg = Daily.config(JSON.stringify({ folder: '', format: 'YYYY/MM/DD/[デイリー]' }));
  const d = new Date(2026, 10, 10);
  assert.equal(Daily.pathOf(d, cfg), '2026/11/10/デイリー.md');
  assert.equal(Daily.dateOf('2026/11/10/デイリー.md', cfg), '2026-11-10');
  assert.equal(Daily.dateOf('Notes/はじめに.md', cfg), null);
});

test('書式：曜日・月・Do', () => {
  const d = new Date(2026, 10, 10);
  assert.equal(Daily.formatDate(d, 'YYYY年M月D日（ddd）'), '2026年11月10日（火）');
  assert.equal(Daily.formatDate(d, '[Daily]/YYYY-MM-DD'), 'Daily/2026-11-10', '文字は [ ] で囲む（Obsidian と同じ）');
});
