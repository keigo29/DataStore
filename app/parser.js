// Markdown → やること（- [ ]）と予定 を取り出す（ブラウザと Node の両方で動く）
// チェックリストの読み方・足し方は Mac の Workstation（ダッシュボードの「今日のノート」）と同じ
const MDParser = (() => {
  const ISO = /(\d{4})-(\d{2})-(\d{2})/;
  const DUE_RES = [
    /@due\((\d{4}-\d{2}-\d{2})\)/,
    /📅\s*(\d{4}-\d{2}-\d{2})/,
    /(?:^|\s)@(\d{4}-\d{2}-\d{2})(?=\s|$)/,
  ];
  const START_RES = [/🛫\s*(\d{4}-\d{2}-\d{2})/u, /@start\((\d{4}-\d{2}-\d{2})\)/];
  const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  const TIME_RE = /^(\d{1,2}:\d{2})(?:\s*[-~〜–]\s*(\d{1,2}:\d{2}))?\s+/;
  const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s*)?(.*)$/;
  const TAG_RE = /(^|[\s(（「、。])#([^\s#.,;:!?()[\]{}"'`、。「」（）<>]+)/g;

  const isoName = path => { const m = path.split('/').pop().match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
  const pad = t => (t.length === 4 ? '0' + t : t);
  const fmLines = text => { const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text); return m ? m[0].split('\n').length - 1 : 0; };

  // 見せる名前：[[リンク|表示名]] は表示名、記号（** == ` など）と日付・タグの印を外す
  function clean(s) {
    return s
      .replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
      .replace(/@(?:due|start)\(\d{4}-\d{2}-\d{2}\)/g, '')
      .replace(/🏁/gu, '')
      .replace(/[📅✅⏳🛫]\s*\d{4}-\d{2}-\d{2}/gu, '')
      .replace(/(^|\s)@\d{4}-\d{2}-\d{2}(?=\s|$)/g, '$1')
      .replace(TAG_RE, '$1')
      .replace(/[*_`=~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // dayOfFile: このファイルがデイリーノートなら、その日（'YYYY-MM-DD'）
  function parse(path, text, dayOfFile) {
    const lines = text.split(/\r?\n/);
    const items = [];
    const base = dayOfFile || isoName(path);
    const stack = [];
    let inCode = false;
    const ctxDate = () => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].date) return stack[k].date; return base; };

    for (let i = fmLines(text); i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; continue; }
      if (inCode) continue;

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const level = h[1].length;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const dm = h[2].match(ISO);
        stack.push({ level, date: dm ? dm[0] : null, title: h[2].trim() });
        continue;
      }
      const m = line.match(LIST_RE);
      if (!m) continue;
      const isTodo = m[2] !== undefined;
      let body = m[3];
      let explicit = null;
      for (const re of DUE_RES) { const d = body.match(re); if (d) { explicit = d[1]; break; } }
      let start = null;
      for (const re of START_RES) { const d = body.match(re); if (d) { start = d[1]; break; } }
      const links = [...body.matchAll(LINK_RE)].map(x => x[1].trim());
      const milestone = /🏁/u.test(body);
      const tags = [];
      for (const t of body.matchAll(TAG_RE)) if (!/^\d+$/.test(t[2])) tags.push(t[2]);
      let time = null, endTime = null;
      const tm = body.match(TIME_RE);
      if (tm) { time = pad(tm[1]); endTime = tm[2] ? pad(tm[2]) : null; body = body.slice(tm[0].length); }
      const title = clean(body);
      const date = explicit || ctxDate();
      const section = stack.length ? stack[stack.length - 1].title : '';
      // start：開始日（🛫 / @start()）。milestone：節目（#節目 / 🏁）。links：[[リンク]]の先（プロジェクトに入れるのに使う）
      const common = { path, line: i, raw: line, title, date, due: explicit, start, milestone: milestone || tags.includes('節目'), links, time, endTime, tags, section };

      if (isTodo) { if (title) items.push({ type: 'todo', done: m[2] !== ' ', ...common }); }
      else if (date && title && (time || explicit || tags.includes('予定'))) items.push({ type: 'event', done: false, ...common });
    }
    return items;
  }

  // 行のチェックを切り替える（行がずれていたら同じ行を探す。見つからなければ null）
  function toggle(text, lineIndex, expectedRaw, done) {
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const ls = text.split(/\r?\n/);
    const i = ls[lineIndex] === expectedRaw ? lineIndex : ls.indexOf(expectedRaw);
    if (i < 0) return null;
    ls[i] = ls[i].replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
    return ls.join(nl);
  }

  // やることを足す（Mac と同じ順）：空の「- [ ] 」→ 最後のチェックリストの下 → 「やること」の見出しの下 → ノートの最後
  function addTodo(text, v) {
    const ls = text.split('\n');
    const fmEnd = fmLines(text);
    const empty = ls.findIndex((l, i) => i >= fmEnd && /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s*$/.test(l));
    if (empty >= 0) { ls[empty] = ls[empty].replace(/\[ \]\s*$/, `[ ] ${v}`); return ls.join('\n'); }
    let last = -1, fence = false;
    for (let i = fmEnd; i < ls.length; i++) {
      if (/^\s*(```|~~~)/.test(ls[i])) { fence = !fence; continue; }
      if (!fence && /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/.test(ls[i])) last = i;
    }
    if (last >= 0) { ls.splice(last + 1, 0, ls[last].match(/^\s*/)[0] + `- [ ] ${v}`); return ls.join('\n'); }
    const h = ls.findIndex((l, i) => i >= fmEnd && /^#{1,6}\s*(やること|TODO|ToDo|タスク)\s*$/i.test(l));
    if (h >= 0) { ls.splice(h + 1, 0, `- [ ] ${v}`); return ls.join('\n'); }
    return text.replace(/\s*$/, '') + `\n\n- [ ] ${v}\n`;
  }

  return { parse, toggle, addTodo, clean };
})();
if (typeof module !== 'undefined') module.exports = MDParser;
