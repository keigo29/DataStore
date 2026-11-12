// ノートの行の読み取り・書きかえ（app/parser.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../app/parser.js');

const DAY = '2026-11-10';
const parse = (text, path = '2026/11/10/デイリー.md') => P.parse(path, text, path.startsWith('2026/11/10/') ? DAY : null);

test('やること：チェック・期限・開始・節目・タグ・リンク', () => {
  const it = parse('- [ ] 資料を作る 📅 2026-11-12 🛫 2026-11-11 #仕事 [[ほのぼの書店]]\n- [x] 終わった\n- [ ] 発表 📅 2026-11-20 #節目\n');
  const [a, b, c] = it;
  assert.equal(a.type, 'todo');
  assert.equal(a.title, '資料を作る ほのぼの書店');
  assert.equal(a.date, '2026-11-12');
  assert.equal(a.start, '2026-11-11');
  assert.deepEqual(a.tags, ['仕事']);
  assert.deepEqual(a.links, ['ほのぼの書店']);
  assert.equal(b.done, true);
  assert.equal(c.milestone, true);
});

test('予定：時刻・終わりの時刻・終日（#予定）・見出しの日付', () => {
  const it = parse('- 10:00 朝会\n- 14:00-15:30 チームMTG\n- 歯医者 #予定\n', 'Notes/メモ.md');
  assert.equal(it.length, 0, '日付のないノートの時刻だけの行は予定にしない');
  const d = parse('- 10:00 朝会\n- 14:00-15:30 チームMTG\n- 歯医者 #予定\n');
  assert.deepEqual(d.map(i => [i.type, i.time, i.endTime, i.title]), [['event', '10:00', null, '朝会'], ['event', '14:00', '15:30', 'チームMTG'], ['event', null, null, '歯医者']]);
  const h = parse('## 2026-11-20\n- 09:00 健康診断\n', 'Notes/予定.md');
  assert.equal(h[0].date, '2026-11-20');
});

test('お金：💸 出費・💰 収入・🏦 貯金。チェックリストはお金にしない', () => {
  const it = parse('- 💸 1,200 ランチ #食費\n- 💰 250,000円 給料\n- 🏦 ¥30000 [[引越し貯金]]\n- [ ] 💸 これはやること\n');
  const m = it.filter(i => i.type === 'money');
  assert.deepEqual(m.map(i => [i.kind, i.amount]), [['out', 1200], ['in', 250000], ['save', 30000]]);
  assert.deepEqual(m[0].tags, ['食費']);
  assert.deepEqual(m[2].links, ['引越し貯金']);
  assert.equal(it.find(i => i.type === 'todo').title, '💸 これはやること');
});

test('toggle：完了は消さずに [x] にする', () => {
  const t = '# x\n- [ ] 牛乳\n';
  const nx = P.toggle(t, 1, '- [ ] 牛乳', true);
  assert.equal(nx, '# x\n- [x] 牛乳\n');
  assert.equal(P.toggle(t, 1, '- [ ] ちがう行', true), null, '行が変わっていたら書かない');
});

test('addEvent・addMoney：見出しの下に足す／なければ作る', () => {
  const e = P.addEvent('# 2026-11-10\n\n## 予定\n- 09:00 a\n\n## メモ\n', { time: '10:00', title: '朝会' });
  assert.match(e, /## 予定\n- 09:00 a\n- 10:00 朝会\n/);
  const m = P.addMoney('# x\n', { kind: 'out', amount: 1200, title: 'ランチ #食費' });
  assert.match(m, /## お金\n- 💸 1,200 ランチ #食費\n$/);
});

test('updateEvent：時刻・タイトルを変えても [[リンク]]・#タグ は残す', () => {
  const raw = '- 10:00 朝会 [[ほのぼの書店]] #仕事';
  const t = `# x\n${raw}\n`;
  assert.equal(P.updateEvent(t, 1, raw, { time: '10:30', endTime: '11:15' }), '# x\n- 10:30-11:15 朝会 [[ほのぼの書店]] #仕事\n');
  assert.equal(P.rewriteEvent(raw, { title: '朝の会 ほのぼの書店', time: '10:00' }), '- 10:00 朝の会 [[ほのぼの書店]] #仕事');
  assert.equal(P.rewriteEvent(raw, { title: '朝の会', time: '10:00' }), '- 10:00 朝の会 [[ほのぼの書店]] #仕事');
  assert.equal(P.rewriteEvent('- 14:00 MTG', { time: null }), '- MTG #予定', '終日にすると #予定 をつける');
  assert.equal(P.rewriteEvent('- 歯医者 #予定', { time: '09:00' }), '- 09:00 歯医者', '時刻をつけると #予定 を外す');
  assert.equal(P.rewriteEvent('- [ ] 11:00 電話 📅 2026-11-12', { time: '11:00', date: '2026-11-13' }), '- [ ] 11:00 電話 📅 2026-11-13');
});

test('removeLine：その行だけ消す。行が変わっていたら消さない', () => {
  assert.equal(P.removeLine('a\n- 10:00 x\nb\n', 1, '- 10:00 x'), 'a\nb\n');
  assert.equal(P.removeLine('a\n- 10:00 x\nb\n', 1, '- 11:00 x'), null);
});

test('出費の予定：- [ ] 💸 のやることに金額がつく（お金の記録にはならない）', () => {
  const it = parse('- [ ] 💸 68,000 家賃 #住まい 📅 2026-11-25\n- [x] 💸 1,200 本 📅 2026-11-08\n- [ ] ふつうのやること\n');
  assert.equal(it.filter(i => i.type === 'money').length, 0);
  const [a, b, c] = it;
  assert.deepEqual([a.type, a.done, a.date, a.money], ['todo', false, '2026-11-25', { kind: 'out', amount: 68000, title: '家賃' }]);
  assert.deepEqual([b.done, b.money.amount], [true, 1200]);
  assert.equal(c.money, undefined);
});
